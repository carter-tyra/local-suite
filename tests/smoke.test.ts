import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runSafeAction } from '../server/actions.ts'
import { loadConfig } from '../server/config.ts'
import { redactSecrets, type CommandResult } from '../server/command.ts'
import { createDevctlCollector } from '../server/devctl.ts'
import {
  correlateListenersToProjects,
  parseListenerCwdOutput,
  parseListeners,
} from '../server/discovery.ts'
import {
  applyListenerRulesToListeners,
  previewIgnoredListenerRule,
  upsertIgnoredListenerRule,
} from '../server/listenerRules.ts'
import {
  createProcessRegistryEntry,
  markProcessRegistryRunning,
  markProcessRegistryExited,
  markProcessRegistryStopRequested,
  readActiveProcessRegistryEntries,
  readProcessRegistrySnapshot,
  readProcessRegistry,
  registryHistoryForProject,
  registryRuntimeProcessesForProject,
} from '../server/processRegistry.ts'
import { createSnapshotCache } from '../server/snapshotCache.ts'
import {
  diagnosticsEndpoint,
  fetchDockerRefreshedSnapshotDiagnostics,
  fetchWarmedSnapshotDiagnostics,
  formatSnapshotDiagnostics,
  refreshDockerEndpoint,
  snapshotEndpoint,
} from '../scripts/diag-snapshot.ts'
import {
  countProjectsByStatus,
  filterProjects,
  getProjectKindFilters,
  toFleetKindFilter,
  toFleetStatusFilter,
} from '../src/fleetFilters.ts'
import { countListenersByFilter, filterListeners, toListenerFilter } from '../src/listenerFilters.ts'
import { summarizeProjectPorts, summarizeUnresolvedListeners } from '../src/portCorrelations.ts'
import { summarizeRunningProjects } from '../src/runtimeSummaries.ts'
import { listenerRuleKey } from '../src/shared/listenerRules.ts'
import { getPrimaryRunTarget, getRunTargetById, getRunTargets } from '../src/shared/runTargets.ts'
import type { LocalSuiteSnapshot, ProjectSummary } from '../src/shared/types.ts'
import {
  RUNTIME_ACTION_FIXTURE_PARAM,
  createRuntimeActionFixture,
  runtimeActionFixtureFromSearch,
} from '../src/components/workbench/actionStateFixtures.ts'
import {
  buildWorkbenchCommands,
  searchForRuntimeActionFixture,
} from '../src/components/workbench/commandPaletteModel.ts'
import {
  buildWorkbenchExceptions,
  exceptionCountLabel,
  projectExceptionSummary,
  projectExceptionTone,
  selectedExceptionFrom,
} from '../src/components/workbench/exceptionModel.ts'
import { runtimeActionState } from '../src/components/workbench/model.ts'

const config = loadConfig()
const ids = new Set(config.projects.map((project) => project.id))
const paths = new Set(config.projects.map((project) => project.path))

assert.equal(ids.size, config.projects.length, 'project ids must be unique')
assert.equal(paths.size, config.projects.length, 'project paths must be unique')
assert.ok(config.projects.some((project) => project.id === 'local-suite'), 'local-suite project must be registered')
assert.ok(config.devctlPath.endsWith('/devctl'), 'devctl path must point to devctl')

const redacted = redactSecrets('OPENAI_API_KEY=sk-testsecretvalue12345')
assert.equal(redacted.redacted, true)
assert.equal(redacted.value.includes('sk-testsecretvalue12345'), false)

const runTargets = getRunTargets({
  hasWorkspace: false,
  manager: 'pnpm',
  packageName: 'fixture',
  scripts: ['build', 'dev', 'preview'],
})
assert.deepEqual(
  runTargets.map((target) => ({
    commandLabel: target.commandLabel,
    label: target.label,
    primary: target.primary,
    script: target.script,
  })),
  [
    { commandLabel: 'pnpm run dev', label: 'Start dev', primary: true, script: 'dev' },
    { commandLabel: 'pnpm run preview', label: 'Run preview', primary: false, script: 'preview' },
    { commandLabel: 'pnpm run build', label: 'Run build', primary: false, script: 'build' },
  ],
)
assert.equal(getPrimaryRunTarget(null), null)
assert.equal(getRunTargetById(null, 'script:dev'), null)
assert.equal(getRunTargetById({
  hasWorkspace: false,
  manager: 'pnpm',
  packageName: 'fixture',
  scripts: ['build', 'dev', 'preview'],
}, 'script:preview')?.commandLabel, 'pnpm run preview')

const actionProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-suite-action-project-'))
fs.writeFileSync(
  path.join(actionProjectDir, 'package.json'),
  JSON.stringify({
    name: 'action-project',
    scripts: {
      dev: 'vite --host 127.0.0.1',
      hold: 'node -e "setTimeout(() => {}, 60000)"',
      preview: 'vite preview --host 127.0.0.1',
    },
  }),
)
fs.writeFileSync(path.join(actionProjectDir, 'pnpm-lock.yaml'), '')
const actionConfig = {
  ...config,
  projects: [
    {
      id: 'action-project',
      displayName: 'Action Project',
      path: actionProjectDir,
      kind: 'app',
      priority: 'active' as const,
      tags: [],
    },
  ],
}
const actionRegistryPath = path.join(actionProjectDir, 'process-registry.json')

const terminalCommands: Array<{ args: string[]; command: string }> = []
const startResult = await runSafeAction(
  actionConfig,
  { actionId: 'script-start', projectId: 'action-project' },
  {
    ghosttyAppName: 'Ghostty.app',
    now: () => new Date('2026-06-29T00:00:00.000Z'),
    processRegistryPath: actionRegistryPath,
    run: async (command, args) => {
      terminalCommands.push({ args, command })
      return commandResult(command, args, '')
    },
  },
)
assert.equal(startResult.exitCode, 0)
assert.equal(startResult.stdout, 'Opened Ghostty with pnpm run dev.')
assert.equal(terminalCommands[0]?.command, '/usr/bin/open')
assert.deepEqual(terminalCommands[0]?.args.slice(0, 4), ['-na', 'Ghostty.app', '--args', `--working-directory=${actionProjectDir}`])
assert.match(startResult.command, /Ghostty\.app/)
assert.match(startResult.command, /pnpm run dev/)
const firstRegistry = await readProcessRegistry(actionRegistryPath)
assert.equal(firstRegistry.entries.length, 1)
assert.equal(firstRegistry.entries[0]?.commandLabel, 'pnpm run dev')
assert.equal(firstRegistry.entries[0]?.projectId, 'action-project')
assert.equal(firstRegistry.entries[0]?.status, 'starting')
assert.equal(firstRegistry.entries[0]?.stopRequestedAt, null)
assert.equal(firstRegistry.entries[0]?.stopResult, null)
const legacyRegistryPath = path.join(actionProjectDir, 'legacy-process-registry.json')
const {
  stopExitCode: _stopExitCode,
  stopRequestedAt: _stopRequestedAt,
  stopRequestedBy: _stopRequestedBy,
  stopResult: _stopResult,
  stopSignal: _stopSignal,
  ...legacyEntry
} = firstRegistry.entries[0]!
fs.writeFileSync(legacyRegistryPath, JSON.stringify({ entries: [legacyEntry], version: 1 }))
const legacyRegistry = await readProcessRegistry(legacyRegistryPath)
assert.equal(legacyRegistry.entries[0]?.stopRequestedAt, null)
assert.equal(legacyRegistry.entries[0]?.stopResult, null)

const previewCommands: Array<{ args: string[]; command: string }> = []
const previewResult = await runSafeAction(
  actionConfig,
  { actionId: 'script-start', projectId: 'action-project', targetId: 'script:preview' },
  {
    ghosttyAppName: 'Ghostty.app',
    processRegistryPath: actionRegistryPath,
    run: async (command, args) => {
      previewCommands.push({ args, command })
      return commandResult(command, args, '')
    },
  },
)
assert.equal(previewResult.exitCode, 0)
assert.equal(previewResult.stdout, 'Opened Ghostty with pnpm run preview.')
assert.equal(previewCommands[0]?.command, '/usr/bin/open')
assert.match(previewResult.command, /pnpm run preview/)
assert.equal((await readProcessRegistry(actionRegistryPath)).entries.length, 2)
await assert.rejects(
  runSafeAction(
    actionConfig,
    { actionId: 'script-start', projectId: 'action-project', targetId: 'script:missing' },
    { processRegistryPath: actionRegistryPath, run: async (command, args) => commandResult(command, args, '') },
  ),
  /Run target not found/,
)
await assert.rejects(
  runSafeAction(
    actionConfig,
    { actionId: 'script-stop', projectId: 'action-project', targetId: 'script:preview' },
    { findRuntimeProcesses: async () => [], processRegistryPath: actionRegistryPath },
  ),
  /Run target only applies to start/,
)

const killCommands: Array<{ args: string[]; command: string }> = []
const stopResult = await runSafeAction(
  actionConfig,
  { actionId: 'script-stop', projectId: 'action-project' },
  {
    findRuntimeProcesses: async () => [
      { bindIp: '127.0.0.1', command: 'node', pid: 4321, port: '3000', scope: 'local' },
      { bindIp: '*', command: 'node', pid: 4321, port: '3001', scope: 'public' },
      { bindIp: '127.0.0.1', command: 'vite', pid: 4322, port: '5173', scope: 'local' },
    ],
    processRegistryPath: actionRegistryPath,
    run: async (command, args) => {
      killCommands.push({ args, command })
      return commandResult(command, args, '')
    },
  },
)
assert.equal(stopResult.exitCode, 0)
assert.equal(stopResult.stdout, 'Sent SIGTERM to 2 processes.')
assert.deepEqual(killCommands, [{ command: '/bin/kill', args: ['-TERM', '4321', '4322'] }])
await assert.rejects(
  runSafeAction(
    actionConfig,
    { actionId: 'script-stop', projectId: 'action-project' },
    { findRuntimeProcesses: async () => [], processRegistryPath: actionRegistryPath },
  ),
  /No project-owned process/,
)

const activeRegistryTarget = getPrimaryRunTarget({
  hasWorkspace: false,
  manager: 'pnpm',
  packageName: 'fixture',
  scripts: ['dev'],
})
assert.ok(activeRegistryTarget)
const activeRegistryEntry = await createProcessRegistryEntry(
  { project: actionConfig.projects[0]!, target: activeRegistryTarget },
  { registryPath: actionRegistryPath, now: () => new Date('2026-06-29T00:01:00.000Z') },
)
await markProcessRegistryRunning(activeRegistryEntry.entryId, {
  childPid: 5432,
  runnerPid: 5431,
}, {
  registryPath: actionRegistryPath,
  now: () => new Date('2026-06-29T00:01:01.000Z'),
})
const activeRegistryEntries = await readActiveProcessRegistryEntries({
  isProcessAlive: (pid) => pid === 5431 || pid === 5432,
  registryPath: actionRegistryPath,
})
const registryRuntimeProcesses = registryRuntimeProcessesForProject(
  actionConfig.projects[0]!,
  activeRegistryEntries,
  (pid) => pid === 5431 || pid === 5432,
)
assert.deepEqual(registryRuntimeProcesses.map((process) => ({
  command: process.command,
  pid: process.pid,
  processGroupPid: process.processGroupPid,
  source: process.source,
  targetId: process.targetId,
})), [
  {
    command: 'pnpm run dev',
    pid: 5432,
    processGroupPid: 5432,
    source: 'registry',
    targetId: 'script:dev',
  },
])
const registryKillCommands: Array<{ args: string[]; command: string }> = []
const registryStopResult = await runSafeAction(
  actionConfig,
  { actionId: 'script-stop', projectId: 'action-project' },
  {
    findRuntimeProcesses: async () => [
      { bindIp: '127.0.0.1', command: 'node', pid: 5432, port: '3000', scope: 'local', source: 'listener' },
      { bindIp: '127.0.0.1', command: 'vite', pid: 9876, port: '5173', scope: 'local', source: 'listener' },
    ],
    isProcessAlive: (pid) => pid === 5431 || pid === 5432,
    now: () => new Date('2026-06-29T00:01:02.000Z'),
    processRegistryPath: actionRegistryPath,
    run: async (command, args) => {
      registryKillCommands.push({ args, command })
      return commandResult(command, args, '')
    },
  },
)
assert.equal(registryStopResult.exitCode, 0)
assert.equal(registryStopResult.stdout, 'Sent SIGTERM to 2 processes.')
assert.deepEqual(registryKillCommands, [{ command: '/bin/kill', args: ['-TERM', '-5432', '9876'] }])
const stopAuditedRegistry = await readProcessRegistry(actionRegistryPath)
const stopAuditedEntry = stopAuditedRegistry.entries.find((entry) => entry.entryId === activeRegistryEntry.entryId)
assert.ok(stopAuditedEntry)
assert.equal(stopAuditedEntry.stopExitCode, 0)
assert.equal(stopAuditedEntry.stopRequestedAt, '2026-06-29T00:01:02.000Z')
assert.equal(stopAuditedEntry.stopRequestedBy, 'local-suite')
assert.equal(stopAuditedEntry.stopResult, 'sent')
assert.equal(stopAuditedEntry.stopSignal, 'SIGTERM')

const historyRegistryPath = path.join(actionProjectDir, 'history-registry.json')
const historyPkg = {
  hasWorkspace: false,
  manager: 'pnpm' as const,
  packageName: 'fixture',
  scripts: ['dev', 'preview'],
}
const historyDevTarget = getRunTargetById(historyPkg, 'script:dev')
const historyPreviewTarget = getRunTargetById(historyPkg, 'script:preview')
assert.ok(historyDevTarget)
assert.ok(historyPreviewTarget)
const historyPreviewEntry = await createProcessRegistryEntry(
  { project: actionConfig.projects[0]!, target: historyPreviewTarget },
  { registryPath: historyRegistryPath, now: () => new Date('2026-06-29T00:02:00.000Z') },
)
await markProcessRegistryExited(
  historyPreviewEntry.entryId,
  { exitCode: 0, signal: null },
  { registryPath: historyRegistryPath, now: () => new Date('2026-06-29T00:02:10.000Z') },
)
const historyDevEntry = await createProcessRegistryEntry(
  { project: actionConfig.projects[0]!, target: historyDevTarget },
  { registryPath: historyRegistryPath, now: () => new Date('2026-06-29T00:03:00.000Z') },
)
await markProcessRegistryRunning(historyDevEntry.entryId, {
  childPid: 7112,
  runnerPid: 7111,
}, {
  registryPath: historyRegistryPath,
  now: () => new Date('2026-06-29T00:03:01.000Z'),
})
await markProcessRegistryStopRequested([historyDevEntry.entryId], {
  exitCode: 0,
  signal: 'SIGTERM',
}, {
  registryPath: historyRegistryPath,
  now: () => new Date('2026-06-29T00:03:02.000Z'),
})
const processRegistrySnapshot = await readProcessRegistrySnapshot({
  isProcessAlive: (pid) => pid === 7111 || pid === 7112,
  registryPath: historyRegistryPath,
})
assert.equal(processRegistrySnapshot.activeEntries.length, 1)
const registryHistory = registryHistoryForProject(actionConfig.projects[0]!, processRegistrySnapshot.entries)
assert.deepEqual(registryHistory.map((entry) => ({
  childPid: entry.childPid,
  commandLabel: entry.commandLabel,
  exitCode: entry.exitCode,
  signal: entry.signal,
  status: entry.status,
  stopRequestedAt: entry.stopRequestedAt,
  stopResult: entry.stopResult,
  stopSignal: entry.stopSignal,
  targetId: entry.targetId,
})), [
  {
    childPid: 7112,
    commandLabel: 'pnpm run dev',
    exitCode: null,
    signal: null,
    status: 'running',
    stopRequestedAt: '2026-06-29T00:03:02.000Z',
    stopResult: 'sent',
    stopSignal: 'SIGTERM',
    targetId: 'script:dev',
  },
  {
    childPid: null,
    commandLabel: 'pnpm run preview',
    exitCode: 0,
    signal: null,
    status: 'exited',
    stopRequestedAt: null,
    stopResult: null,
    stopSignal: null,
    targetId: 'script:preview',
  },
])
assert.equal('projectPath' in registryHistory[0]!, false)

const runnerRegistryPath = path.join(actionProjectDir, 'runner-registry.json')
const runnerTarget = {
  commandLabel: 'npm run hold',
  id: 'script:hold',
  label: 'Run hold',
  manager: 'npm' as const,
  primary: false,
  script: 'hold',
}
const runnerEntry = await createProcessRegistryEntry(
  { project: actionConfig.projects[0]!, target: runnerTarget },
  { registryPath: runnerRegistryPath, now: () => new Date('2026-06-29T00:02:00.000Z') },
)
const runnerProcess = spawn(
  path.join(process.cwd(), 'node_modules', '.bin', 'tsx'),
  [
    path.join(process.cwd(), 'scripts', 'run-target-runner.ts'),
    '--registry',
    runnerRegistryPath,
    '--entry-id',
    runnerEntry.entryId,
    '--project-path',
    actionProjectDir,
    '--manager',
    runnerTarget.manager,
    '--script',
    runnerTarget.script,
    '--command-label',
    runnerTarget.commandLabel,
  ],
  { stdio: 'ignore' },
)
const runningRunnerEntry = await waitForRegistryEntry(runnerRegistryPath, runnerEntry.entryId, (entry) => (
  entry.status === 'running' && entry.childPid !== null && entry.runnerPid !== null
))
assert.equal(runningRunnerEntry.commandLabel, 'npm run hold')
assert.ok(runningRunnerEntry.childPid)
process.kill(-runningRunnerEntry.childPid, 'SIGTERM')
await new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => {
    runnerProcess.kill('SIGTERM')
    reject(new Error('runner did not exit after child SIGTERM'))
  }, 5_000)
  runnerProcess.once('exit', () => {
    clearTimeout(timeout)
    resolve()
  })
})
const exitedRunnerEntry = await waitForRegistryEntry(runnerRegistryPath, runnerEntry.entryId, (entry) => entry.status === 'failed')
assert.equal(exitedRunnerEntry.signal, 'SIGTERM')
assert.equal(exitedRunnerEntry.stopRequestedAt, null)
fs.rmSync(actionProjectDir, { force: true, recursive: true })

let devctlNow = 1_000
let devctlCommandCount = 0
const devctlState = makeDevctlState({ publicPort: false })
const devctlCollector = createDevctlCollector({
  freshMs: 30_000,
  now: () => devctlNow,
  run: async (command, args) => {
    devctlCommandCount += 1
    assert.equal(command, config.devctlPath)
    assert.deepEqual(args, ['--json', 'status'])
    return commandResult(command, args, JSON.stringify(devctlState))
  },
})
const firstDevctl = await devctlCollector.collect(config)
assert.deepEqual(firstDevctl.cache, {
  ageMs: 0,
  freshForMs: 30_000,
  generatedAt: '1970-01-01T00:00:01.000Z',
  source: 'fresh',
})
assert.equal(firstDevctl.fleet.runningContainers, 1)
assert.equal(firstDevctl.fleet.publicPortCount, 0)
assert.equal(firstDevctl.fleet.publicPortsMessage, 'No matching exposed ports.')
assert.equal(devctlCommandCount, 1)
devctlNow += 5_000
const cachedDevctl = await devctlCollector.collect(config)
assert.equal(cachedDevctl.raw, firstDevctl.raw)
assert.deepEqual(cachedDevctl.cache, {
  ageMs: 5_000,
  freshForMs: 30_000,
  generatedAt: '1970-01-01T00:00:01.000Z',
  source: 'cached',
})
assert.equal(devctlCommandCount, 1)
devctlNow += 25_001
const refreshedDevctl = await devctlCollector.collect(config)
assert.notEqual(refreshedDevctl, firstDevctl)
assert.equal(refreshedDevctl.cache.source, 'fresh')
assert.equal(devctlCommandCount, 2)

let releaseDevctlStatus: () => void = () => {
  throw new Error('devctl status release was not registered.')
}
let inFlightDevctlCommandCount = 0
const inFlightDevctlCollector = createDevctlCollector({
  now: () => 1_000,
  run: async (command, args) => {
    inFlightDevctlCommandCount += 1
    await new Promise<void>((resolve) => {
      releaseDevctlStatus = resolve
    })
    return commandResult(command, args, JSON.stringify(makeDevctlState({ publicPort: true })))
  },
})
const inFlightA = inFlightDevctlCollector.collect(config)
const inFlightB = inFlightDevctlCollector.collect(config)
assert.equal(inFlightDevctlCommandCount, 1)
releaseDevctlStatus()
const [publicDevctlA, publicDevctlB] = await Promise.all([inFlightA, inFlightB])
assert.equal(publicDevctlA.raw, publicDevctlB.raw)
assert.equal(publicDevctlA.cache.source, 'fresh')
assert.equal(publicDevctlB.cache.source, 'fresh')
assert.equal(publicDevctlA.fleet.publicPortCount, 1)
assert.match(publicDevctlA.fleet.publicPortsMessage, /api agentdock \*:8080->3000/)

let releaseInvalidatedDevctlStatus: () => void = () => {
  throw new Error('invalidated devctl status release was not registered.')
}
let invalidatedDevctlCommandCount = 0
const invalidatedDevctlCollector = createDevctlCollector({
  now: () => 1_000,
  run: async (command, args) => {
    invalidatedDevctlCommandCount += 1
    if (invalidatedDevctlCommandCount === 1) {
      await new Promise<void>((resolve) => {
        releaseInvalidatedDevctlStatus = resolve
      })
    }
    return commandResult(command, args, JSON.stringify(makeDevctlState({ publicPort: false })))
  },
})
const invalidatedDevctlRequest = invalidatedDevctlCollector.collect(config)
assert.equal(invalidatedDevctlCommandCount, 1)
invalidatedDevctlCollector.invalidate()
releaseInvalidatedDevctlStatus()
await invalidatedDevctlRequest
const postInvalidationDevctl = await invalidatedDevctlCollector.collect(config)
assert.equal(postInvalidationDevctl.cache.source, 'fresh')
assert.equal(invalidatedDevctlCommandCount, 2)

const listenerFixture = [
  'COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME',
  'node     1234 user   17u  IPv6 0x123456789abcdef0      0t0  TCP *:24678 (LISTEN)',
  'node     1234 user   16u  IPv4 0x123456789abcdef1      0t0  TCP 127.0.0.1:4111 (LISTEN)',
  'rapportd  603 user   12u  IPv6 0x123456789abcdef2      0t0  TCP *:49540 (LISTEN)',
  'node     9999 user   18u  IPv4 0x123456789abcdef3      0t0  TCP 127.0.0.1:3003 (LISTEN)',
  'com.docke 2222 user   19u  IPv4 0x123456789abcdef4      0t0  TCP 127.0.0.1:55433 (LISTEN)',
].join('\n')
const parsedListeners = parseListeners(listenerFixture, 1234)
assert.deepEqual(
  parsedListeners.map((listener) => ({
    bindIp: listener.bindIp,
    owner: listener.owner,
    port: listener.port,
    scope: listener.scope,
  })),
  [
    { bindIp: '*', owner: 'local-suite', port: '24678', scope: 'public' },
    { bindIp: '127.0.0.1', owner: 'local-suite', port: '4111', scope: 'local' },
    { bindIp: '*', owner: 'external', port: '49540', scope: 'public' },
    { bindIp: '127.0.0.1', owner: 'external', port: '3003', scope: 'local' },
    { bindIp: '127.0.0.1', owner: 'external', port: '55433', scope: 'local' },
  ],
)
assert.deepEqual(
  countListenersByFilter(parsedListeners),
  { 'external-public': 1, ignored: 0, 'local-only': 2, 'local-suite': 2 },
)
assert.deepEqual(
  filterListeners(parsedListeners, 'external-public').map((listener) => listener.port),
  ['49540'],
)
assert.deepEqual(
  filterListeners(parsedListeners, 'local-suite').map((listener) => listener.port),
  ['24678', '4111'],
)
assert.deepEqual(
  filterListeners(parsedListeners, 'local-only').map((listener) => listener.port),
  ['3003', '55433'],
)
assert.deepEqual(
  filterListeners(parsedListeners, 'ignored').map((listener) => listener.port),
  [],
)
assert.equal(toListenerFilter('missing'), 'external-public')

const fixtureProjects: ProjectSummary[] = [
  makeProject({
    displayName: 'Local Suite',
    dockerPorts: [],
    id: 'local-suite',
    kind: 'control-plane',
    scripts: ['dev'],
    signals: [],
    status: 'ready',
  }),
  makeProject({
    displayName: 'Aerial Sports',
    dockerPorts: ['127.0.0.1:55433'],
    id: 'aerial-sports',
    kind: 'sports-control-room',
    scripts: ['dev', 'db:local:down'],
    signals: ['Heavy Docker stack'],
    status: 'attention',
  }),
  makeProject({
    displayName: 'Dewpoint',
    dockerPorts: ['127.0.0.1:55435'],
    id: 'dewpoint',
    kind: 'app',
    scripts: ['dev'],
    signals: [],
    status: 'ready',
  }),
]

const localSuiteProject = fixtureProjects[0]!
const localSuiteTarget = localSuiteProject.runtime.primaryTarget
assert.ok(localSuiteTarget)
assert.deepEqual(
  runtimeActionState({
    actionError: null,
    actionResult: null,
    lastRequest: { actionId: 'script-start', projectId: 'local-suite', targetId: localSuiteTarget.id },
    pendingRequest: { actionId: 'script-start', projectId: 'local-suite', targetId: localSuiteTarget.id },
    project: localSuiteProject,
    selectedRunTarget: localSuiteTarget,
  }),
  {
    actionId: 'script-start',
    detail: 'pnpm run dev',
    phase: 'pending',
    projectId: 'local-suite',
    title: 'Starting',
    tone: 'warning',
  },
)
assert.deepEqual(
  runtimeActionState({
    actionError: null,
    actionResult: {
      actionId: 'script-stop',
      command: '/bin/kill -TERM 1234',
      exitCode: 0,
      generatedAt: '2026-06-29T00:04:00.000Z',
      projectId: 'local-suite',
      redacted: false,
      stderr: '',
      stdout: 'Sent SIGTERM to 1 process.',
    },
    lastRequest: { actionId: 'script-stop', projectId: 'local-suite' },
    pendingRequest: null,
    project: localSuiteProject,
    selectedRunTarget: localSuiteTarget,
  }),
  {
    actionId: 'script-stop',
    detail: 'Sent SIGTERM to 1 process.',
    phase: 'success',
    projectId: 'local-suite',
    title: 'Stop sent',
    tone: 'success',
  },
)
assert.deepEqual(
  runtimeActionState({
    actionError: 'No project-owned process was found.',
    actionResult: null,
    lastRequest: { actionId: 'script-stop', projectId: 'local-suite' },
    pendingRequest: null,
    project: localSuiteProject,
    selectedRunTarget: localSuiteTarget,
  }),
  {
    actionId: 'script-stop',
    detail: 'No project-owned process was found.',
    phase: 'failed',
    projectId: 'local-suite',
    title: 'Stop failed',
    tone: 'error',
  },
)
const staleRuntimeProject: ProjectSummary = {
  ...localSuiteProject,
  runtime: {
    ...localSuiteProject.runtime,
    history: [
      {
        childPid: null,
        commandLabel: 'pnpm run dev',
        entryId: 'stale-entry',
        exitCode: null,
        exitedAt: '2026-06-29T00:05:00.000Z',
        runnerPid: null,
        script: 'dev',
        signal: null,
        startedAt: '2026-06-29T00:04:00.000Z',
        status: 'stale',
        stopExitCode: null,
        stopRequestedAt: null,
        stopRequestedBy: null,
        stopResult: null,
        stopSignal: null,
        targetId: localSuiteTarget.id,
        updatedAt: '2026-06-29T00:05:00.000Z',
      },
    ],
  },
}
assert.deepEqual(
  runtimeActionState({
    actionError: null,
    actionResult: null,
    lastRequest: null,
    pendingRequest: null,
    project: staleRuntimeProject,
    selectedRunTarget: localSuiteTarget,
  }),
  {
    actionId: 'script-start',
    detail: 'pnpm run dev lost its process',
    phase: 'stale',
    projectId: 'local-suite',
    title: 'Stale process',
    tone: 'warning',
  },
)
assert.deepEqual(
  runtimeActionState({
    actionError: null,
    actionResult: {
      actionId: 'script-start',
      command: '/usr/bin/open -na Ghostty.app',
      exitCode: 0,
      generatedAt: '2026-06-29T00:06:00.000Z',
      projectId: 'local-suite',
      redacted: false,
      stderr: '',
      stdout: 'Opened Ghostty with pnpm run dev.',
    },
    lastRequest: { actionId: 'script-start', projectId: 'local-suite', targetId: localSuiteTarget.id },
    pendingRequest: null,
    project: staleRuntimeProject,
    selectedRunTarget: localSuiteTarget,
  }),
  {
    actionId: 'script-start',
    detail: 'Opened Ghostty with pnpm run dev.',
    phase: 'success',
    projectId: 'local-suite',
    title: 'Started',
    tone: 'success',
  },
)
assert.equal(runtimeActionFixtureFromSearch(`?${RUNTIME_ACTION_FIXTURE_PARAM}=pending-start`), 'pending-start')
assert.equal(runtimeActionFixtureFromSearch(`?${RUNTIME_ACTION_FIXTURE_PARAM}=missing`), null)
const pendingStartFixture = createRuntimeActionFixture({
  id: 'pending-start',
  now: '2026-06-29T00:06:00.000Z',
  project: localSuiteProject,
  selectedRunTarget: localSuiteTarget,
})
assert.equal(pendingStartFixture.actionPending, true)
assert.equal(pendingStartFixture.actionRequest?.actionId, 'script-start')
assert.equal(pendingStartFixture.state.phase, 'pending')
assert.equal(pendingStartFixture.state.source, 'fixture')
const stopSuccessFixture = createRuntimeActionFixture({
  id: 'stop-success',
  now: '2026-06-29T00:06:00.000Z',
  project: localSuiteProject,
  selectedRunTarget: localSuiteTarget,
})
assert.equal(stopSuccessFixture.actionResult?.actionId, 'script-stop')
assert.equal(stopSuccessFixture.state.phase, 'success')
assert.equal(stopSuccessFixture.state.source, 'fixture')
const startFailedFixture = createRuntimeActionFixture({
  id: 'start-failed',
  now: '2026-06-29T00:06:00.000Z',
  project: localSuiteProject,
  selectedRunTarget: localSuiteTarget,
})
assert.equal(startFailedFixture.actionError, 'Ghostty failed to open.')
assert.equal(startFailedFixture.state.phase, 'failed')
assert.equal(startFailedFixture.state.source, 'fixture')
const staleFixture = createRuntimeActionFixture({
  id: 'stale',
  now: '2026-06-29T00:06:00.000Z',
  project: localSuiteProject,
  selectedRunTarget: localSuiteTarget,
})
assert.equal(staleFixture.project.runtime.history[0]?.status, 'stale')
assert.equal(staleFixture.state.phase, 'stale')
assert.equal(staleFixture.state.source, 'fixture')

const commandProject: ProjectSummary = {
  ...localSuiteProject,
  actions: [
    {
      disabled: false,
      id: 'script-start',
      kind: 'terminal',
      label: 'Start',
      reason: 'Open Ghostty',
    },
    {
      disabled: false,
      id: 'script-stop',
      kind: 'process',
      label: 'Stop',
      reason: 'Stop owned processes',
    },
  ],
}
const runningDewpoint: ProjectSummary = {
  ...fixtureProjects[2]!,
  runtime: {
    ...fixtureProjects[2]!.runtime,
    ownedProcesses: [
      { bindIp: '127.0.0.1', command: 'next-server --port 3003', pid: 9101, port: '3003', scope: 'local' },
    ],
    status: 'running',
    stopReason: '1 owned process',
  },
}
const dirtyAerialSports: ProjectSummary = {
  ...fixtureProjects[1]!,
  git: {
    ...fixtureProjects[1]!.git,
    dirtyCount: 2,
    status: 'dirty',
  },
}
const commandSnapshot: LocalSuiteSnapshot = {
  ...makeSnapshot('2026-06-29T00:07:00.000Z'),
  projects: [dirtyAerialSports, commandProject, runningDewpoint],
}
const workbenchCommands = buildWorkbenchCommands({
  actionPending: false,
  currentDetailTab: 'run',
  currentDialog: null,
  isDev: true,
  runtimeActionFixtureId: null,
  selectedProject: commandProject,
  selectedRunTarget: localSuiteTarget,
  snapshot: commandSnapshot,
})
assert.ok(workbenchCommands.some((command) => command.command.kind === 'project'), 'project commands are present')
assert.ok(workbenchCommands.some((command) => command.command.kind === 'action'), 'action commands are present')
assert.ok(workbenchCommands.some((command) => command.command.kind === 'view'), 'view commands are present')
assert.ok(workbenchCommands.some((command) => command.command.kind === 'detail'), 'detail commands are present')
assert.ok(workbenchCommands.some((command) => command.command.kind === 'fixture'), 'fixture commands are present')
assert.deepEqual(
  workbenchCommands
    .filter((command) => command.command.kind === 'project')
    .map((command) => command.id)
    .slice(0, 3),
  ['project:local-suite', 'project:dewpoint', 'project:aerial-sports'],
)
const startCommand = workbenchCommands.find((command) => (
  command.command.kind === 'action' && command.command.actionId === 'script-start'
))
if (!startCommand || startCommand.command.kind !== 'action') {
  throw new Error('Missing start command')
}
assert.equal(startCommand.disabledReason, undefined)
assert.equal(startCommand.command.targetId, localSuiteTarget.id)
const stopCommand = workbenchCommands.find((command) => (
  command.command.kind === 'action' && command.command.actionId === 'script-stop'
))
assert.equal(stopCommand?.disabledReason, 'Project is stopped')
const noTargetCommands = buildWorkbenchCommands({
  actionPending: false,
  currentDetailTab: 'run',
  currentDialog: null,
  isDev: true,
  runtimeActionFixtureId: null,
  selectedProject: {
    ...commandProject,
    runtime: {
      ...commandProject.runtime,
      primaryTarget: null,
      targets: [],
    },
  },
  selectedRunTarget: null,
  snapshot: commandSnapshot,
})
const disabledStartCommand = noTargetCommands.find((command) => (
  command.command.kind === 'action' && command.command.actionId === 'script-start'
))
assert.equal(disabledStartCommand?.disabledReason, 'No run target')
const activeFixtureCommands = buildWorkbenchCommands({
  actionPending: false,
  currentDetailTab: 'run',
  currentDialog: null,
  isDev: true,
  runtimeActionFixtureId: 'pending-start',
  selectedProject: commandProject,
  selectedRunTarget: localSuiteTarget,
  snapshot: commandSnapshot,
})
assert.equal(activeFixtureCommands.find((command) => command.id === 'fixture:clear')?.command.kind, 'fixture')
assert.equal(
  buildWorkbenchCommands({
    actionPending: false,
    currentDetailTab: 'run',
    currentDialog: null,
    isDev: false,
    runtimeActionFixtureId: null,
    selectedProject: commandProject,
    selectedRunTarget: localSuiteTarget,
    snapshot: commandSnapshot,
  }).some((command) => command.command.kind === 'fixture'),
  false,
)
assert.equal(
  workbenchCommands.some((command) => command.command.kind === 'action' && command.id.startsWith('fixture:')),
  false,
)
assert.equal(
  searchForRuntimeActionFixture('?tab=run', 'pending-start'),
  `?tab=run&${RUNTIME_ACTION_FIXTURE_PARAM}=pending-start`,
)
assert.equal(
  searchForRuntimeActionFixture(`?${RUNTIME_ACTION_FIXTURE_PARAM}=pending-start&tab=run`, null),
  '?tab=run',
)

const cwdOutput = ['p9999', 'fcwd', 'n/tmp/dewpoint', 'p1234', 'fcwd', 'n/tmp/local-suite'].join('\n')
assert.deepEqual(Array.from(parseListenerCwdOutput(cwdOutput)), [
  [9999, '/tmp/dewpoint'],
  [1234, '/tmp/local-suite'],
])

const correlatedListeners = correlateListenersToProjects(parsedListeners, fixtureProjects, parseListenerCwdOutput(cwdOutput))
assert.deepEqual(
  correlatedListeners.map((listener) => ({
    match: listener.projectMatch,
    port: listener.port,
    projectId: listener.projectId,
  })),
  [
    { match: 'local-suite', port: '24678', projectId: 'local-suite' },
    { match: 'local-suite', port: '4111', projectId: 'local-suite' },
    { match: null, port: '49540', projectId: null },
    { match: 'process-cwd', port: '3003', projectId: 'dewpoint' },
    { match: 'docker-port', port: '55433', projectId: 'aerial-sports' },
  ],
)

const exceptionSnapshotBase = makeSnapshot('2026-06-29T00:08:00.000Z')
const exceptionSnapshot: LocalSuiteSnapshot = {
  ...exceptionSnapshotBase,
  docker: {
    ...exceptionSnapshotBase.docker,
    memMib: 6_144,
    memoryLimitMib: 8_192,
    runningContainers: 6,
    totalContainers: 8,
  },
  listeners: correlatedListeners,
  projects: [dirtyAerialSports, commandProject, runningDewpoint],
}
const exceptions = buildWorkbenchExceptions(exceptionSnapshot)
assert.deepEqual(
  exceptions.map((exception) => exception.id),
  ['public-listeners', 'unresolved-listeners', 'stopped-active', 'dirty-repos', 'docker-memory'],
)
assert.equal(exceptionCountLabel(exceptions), '5')
assert.equal(selectedExceptionFrom(exceptions, 'dirty-repos').primaryProjectId, 'aerial-sports')
assert.equal(projectExceptionSummary(dirtyAerialSports, exceptionSnapshot), '2 changed')
assert.equal(projectExceptionTone(dirtyAerialSports, exceptionSnapshot), 'warning')
assert.equal(projectExceptionSummary(runningDewpoint, exceptionSnapshot), '1 process')
assert.equal(projectExceptionTone(runningDewpoint, exceptionSnapshot), 'success')

const clearProject: ProjectSummary = {
  ...localSuiteProject,
  runtime: {
    ...localSuiteProject.runtime,
    ownedProcesses: [
      { bindIp: '127.0.0.1', command: 'pnpm run dev', pid: 4112, port: '4112', scope: 'local' },
    ],
    status: 'running',
    stopReason: '1 owned process',
  },
}
const clearSnapshot: LocalSuiteSnapshot = {
  ...makeSnapshot('2026-06-29T00:09:00.000Z'),
  projects: [clearProject],
  summary: {
    activeProjects: 1,
    attentionProjects: 0,
    configuredProjects: 1,
    dirtyRepos: 0,
    discoveredProjects: 0,
    packageProjects: 1,
  },
}
const clearExceptions = buildWorkbenchExceptions(clearSnapshot)
assert.equal(clearExceptions[0]?.id, 'all-clear')
assert.equal(exceptionCountLabel(clearExceptions), '0')

assert.deepEqual(summarizeUnresolvedListeners(correlatedListeners), [
  {
    bindIp: '*',
    command: 'rapportd',
    count: 1,
    key: 'public:*:49540:rapportd',
    port: '49540',
    scope: 'public',
  },
])
assert.deepEqual(
  summarizeUnresolvedListeners([...correlatedListeners, correlatedListeners[2]]).map((item) => ({
    count: item.count,
    key: item.key,
  })),
  [{ count: 2, key: 'public:*:49540:rapportd' }],
)

const rapportdRuleInput = {
  bindIp: '*',
  command: 'rapportd',
  key: listenerRuleKey({ bindIp: '*', command: 'rapportd', port: '49540', scope: 'public' }),
  port: '49540',
  reason: 'System sharing listener',
  scope: 'public' as const,
}
assert.equal(rapportdRuleInput.key, 'public:*:49540:rapportd')

const ignoredRules = {
  version: 1 as const,
  ignored: [
    {
      ...rapportdRuleInput,
      createdAt: '2026-06-28T00:00:00.000Z',
      reason: 'System sharing listener',
    },
  ],
}
const ignoredListeners = applyListenerRulesToListeners(correlatedListeners, ignoredRules)
assert.equal(ignoredListeners.find((listener) => listener.port === '49540')?.classification, 'ignored')
assert.deepEqual(summarizeUnresolvedListeners(ignoredListeners), [])
assert.deepEqual(
  countListenersByFilter(ignoredListeners),
  { 'external-public': 0, ignored: 1, 'local-only': 2, 'local-suite': 2 },
)
assert.deepEqual(
  filterListeners(ignoredListeners, 'ignored').map((listener) => listener.port),
  ['49540'],
)

const existingPreview = previewIgnoredListenerRule(rapportdRuleInput, correlatedListeners, ignoredRules)
assert.deepEqual(
  {
    action: existingPreview.action,
    alreadyIgnored: existingPreview.alreadyIgnored,
    key: existingPreview.key,
    matchingListeners: existingPreview.matchingListeners,
    reason: existingPreview.reason,
  },
  {
    action: 'ignore',
    alreadyIgnored: true,
    key: 'public:*:49540:rapportd',
    matchingListeners: 1,
    reason: 'System sharing listener',
  },
)
assert.ok(!Number.isNaN(new Date(existingPreview.generatedAt).getTime()))

const tempRulesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-suite-listener-rules-'))
const tempRulesPath = path.join(tempRulesDir, 'listener-rules.json')
const writeResult = await upsertIgnoredListenerRule(rapportdRuleInput, correlatedListeners, tempRulesPath)
const writtenRules = JSON.parse(fs.readFileSync(tempRulesPath, 'utf8')) as typeof ignoredRules
assert.equal(writeResult.applied, true)
assert.equal(writeResult.ignoredCount, 1)
assert.equal(writtenRules.ignored[0]?.key, 'public:*:49540:rapportd')
fs.rmSync(tempRulesDir, { force: true, recursive: true })

const portSummaries = summarizeProjectPorts(fixtureProjects, correlatedListeners)
assert.deepEqual(
  portSummaries.map((summary) => ({
    ports: summary.ports.map((port) => ({ port: port.port, source: port.source })),
    projectId: summary.projectId,
  })),
  [
    {
      ports: [
        { port: '4111', source: 'listener' },
        { port: '24678', source: 'listener' },
      ],
      projectId: 'local-suite',
    },
    {
      ports: [{ port: '55433', source: 'both' }],
      projectId: 'aerial-sports',
    },
    {
      ports: [
        { port: '3003', source: 'listener' },
        { port: '55435', source: 'docker' },
      ],
      projectId: 'dewpoint',
    },
  ],
)

assert.deepEqual(
  filterProjects(fixtureProjects, { kind: 'all', query: 'sports 55433', status: 'all' }).map((project) => project.id),
  ['aerial-sports'],
)
assert.deepEqual(
  filterProjects(fixtureProjects, { kind: 'all', query: '', status: 'ready' }).map((project) => project.id),
  ['local-suite', 'dewpoint'],
)
assert.deepEqual(
  filterProjects(fixtureProjects, { kind: 'app', query: '', status: 'all' }).map((project) => project.id),
  ['dewpoint'],
)
assert.equal(countProjectsByStatus(fixtureProjects).attention, 1)
assert.equal(toFleetStatusFilter('invalid'), 'all')
assert.deepEqual(getProjectKindFilters(fixtureProjects), [
  { count: 3, label: 'All kinds', value: 'all' },
  { count: 1, label: 'app', value: 'app' },
  { count: 1, label: 'control-plane', value: 'control-plane' },
  { count: 1, label: 'sports-control-room', value: 'sports-control-room' },
])
assert.equal(toFleetKindFilter('missing', fixtureProjects), 'all')
assert.equal(toFleetKindFilter('sports-control-room', fixtureProjects), 'sports-control-room')

const runningSummaries = summarizeRunningProjects([
  {
    ...fixtureProjects[0],
    runtime: {
      ...fixtureProjects[0]!.runtime,
      ownedProcesses: [
        { bindIp: '127.0.0.1', command: '/opt/homebrew/bin/node --secret token', pid: 9001, port: '4111', scope: 'local' },
        { bindIp: '127.0.0.1', command: 'node --inspect', pid: 9001, port: '24678', scope: 'local' },
        { bindIp: '*', command: 'vite dev --host 0.0.0.0', pid: 9002, port: '5173', scope: 'public' },
        { bindIp: '127.0.0.1', command: 'pnpm run worker', pid: 9003, port: '7000', scope: 'local' },
        { bindIp: '127.0.0.1', command: 'tsx server/index.ts', pid: 9004, port: '7001', scope: 'local' },
        {
          bindIp: null,
          command: 'pnpm run test',
          pid: 9005,
          port: null,
          scope: 'local',
          source: 'registry',
          targetId: 'script:test',
        },
      ],
      status: 'running',
      stopReason: '5 owned processes',
    },
  },
  {
    ...fixtureProjects[2],
    runtime: {
      ...fixtureProjects[2]!.runtime,
      ownedProcesses: [
        { bindIp: '127.0.0.1', command: 'next-server --port 3003', pid: 9101, port: '3003', scope: 'local' },
      ],
      status: 'running',
      stopReason: '1 owned process',
    },
  },
  fixtureProjects[1]!,
])
assert.deepEqual(
  runningSummaries.map((summary) => ({
    commandsLabel: summary.commandsLabel,
    hasPublicPort: summary.hasPublicPort,
    portsLabel: summary.portsLabel,
    processCount: summary.processCount,
    projectId: summary.projectId,
    scopeLabel: summary.scopeLabel,
    trackedCount: summary.trackedCount,
  })),
  [
    {
      commandsLabel: 'node, vite, pnpm +2',
      hasPublicPort: true,
      portsLabel: '4111, 5173, 7000, 7001 +1',
      processCount: 5,
      projectId: 'local-suite',
      scopeLabel: 'public',
      trackedCount: 1,
    },
    {
      commandsLabel: 'next-server',
      hasPublicPort: false,
      portsLabel: '3003',
      processCount: 1,
      projectId: 'dewpoint',
      scopeLabel: 'local',
      trackedCount: 0,
    },
  ],
)
assert.equal(runningSummaries[0]?.commandsLabel.includes('secret'), false)
assert.equal(summarizeRunningProjects([fixtureProjects[1]!]).length, 0)

let cacheNow = 1_000
let cacheBuilds = 0
const snapshotCache = createSnapshotCache({
  build: async () => makeSnapshot(`2026-06-28T00:00:0${cacheBuilds++}.000Z`),
  freshMs: 10,
  maxStaleMs: 100,
  now: () => cacheNow,
})
const emptyDiagnostics = snapshotCache.getDiagnostics()
assert.equal(emptyDiagnostics.cache.state, 'empty')
assert.equal(emptyDiagnostics.cache.hasSnapshot, false)
assert.equal(emptyDiagnostics.snapshot, null)
const emptyDiagnosticsOutput = formatSnapshotDiagnostics(emptyDiagnostics, diagnosticsEndpoint('http://127.0.0.1:4111'))
assert.match(emptyDiagnosticsOutput, /Local Suite snapshot diagnostics/)
assert.match(emptyDiagnosticsOutput, /Cache\s+empty/)
assert.match(emptyDiagnosticsOutput, /No cached snapshot/)

const firstSnapshot = await snapshotCache.getSnapshot(config)
assert.equal(firstSnapshot.cache?.state, 'miss')
assert.equal(firstSnapshot.generatedAt, '2026-06-28T00:00:00.000Z')
assert.equal(cacheBuilds, 1)

const firstDiagnostics = snapshotCache.getDiagnostics()
assert.equal(firstDiagnostics.cache.state, 'fresh')
assert.equal(firstDiagnostics.cache.hasSnapshot, true)
assert.equal(firstDiagnostics.snapshot?.counts.projects, fixtureProjects.length)
assert.equal(firstDiagnostics.snapshot?.counts.publicDockerPorts, 0)
assert.deepEqual(firstDiagnostics.snapshot?.timing.phases, { test: 1 })
const diagnosticsOutput = formatSnapshotDiagnostics(firstDiagnostics, 'http://127.0.0.1:4111/api/dev/snapshot-diagnostics')
assert.match(diagnosticsOutput, /Projects\s+3 total \/ 1 attention \/ 0 dirty/)
assert.match(diagnosticsOutput, /Docker\s+0 running \/ 0 public ports/)
assert.match(diagnosticsOutput, /Docker state\s+fresh \/ age 0ms \/ fresh 30s/)
assert.match(diagnosticsOutput, /Timing/)
assert.match(diagnosticsOutput, /total\s+1ms/)
assert.match(diagnosticsOutput, /test\s+1ms/)

const diagnosticsUrl = diagnosticsEndpoint('http://127.0.0.1:4111')
const refreshDockerUrl = refreshDockerEndpoint('http://127.0.0.1:4111')
const snapshotUrl = snapshotEndpoint('http://127.0.0.1:4111')
const warmRequests: string[] = []
const warmedDiagnostics = await fetchWarmedSnapshotDiagnostics('http://127.0.0.1:4111', async (input) => {
  const url = requestUrl(input)
  warmRequests.push(url)

  if (url === snapshotUrl) return jsonResponse({ ok: true })
  if (url === diagnosticsUrl) {
    const diagnosticsRequestCount = warmRequests.filter((request) => request === diagnosticsUrl).length
    return jsonResponse(diagnosticsRequestCount === 1 ? emptyDiagnostics : firstDiagnostics)
  }

  return jsonResponse({ error: 'Not found' }, { status: 404, statusText: 'Not Found' })
})
assert.deepEqual(warmRequests, [diagnosticsUrl, snapshotUrl, diagnosticsUrl])
assert.equal(warmedDiagnostics.cache.state, 'fresh')

let warmAttemptedSnapshot = false
await assert.rejects(
  fetchWarmedSnapshotDiagnostics('http://127.0.0.1:4111', async (input) => {
    const url = requestUrl(input)
    if (url === snapshotUrl) warmAttemptedSnapshot = true
    return jsonResponse({ error: 'Not found' }, { status: 404, statusText: 'Not Found' })
  }),
  /dev-only/,
)
assert.equal(warmAttemptedSnapshot, false)

const refreshDockerRequests: Array<{ method: string; url: string }> = []
const refreshedDockerDiagnostics = await fetchDockerRefreshedSnapshotDiagnostics('http://127.0.0.1:4111', async (input, init) => {
  const url = requestUrl(input)
  refreshDockerRequests.push({ method: init?.method ?? 'GET', url })

  if (url === refreshDockerUrl) return jsonResponse(firstDiagnostics)
  return jsonResponse({ error: 'Not found' }, { status: 404, statusText: 'Not Found' })
})
assert.deepEqual(refreshDockerRequests, [{ method: 'POST', url: refreshDockerUrl }])
assert.equal(refreshedDockerDiagnostics.snapshot?.dockerState.source, 'fresh')

await assert.rejects(
  fetchDockerRefreshedSnapshotDiagnostics('http://127.0.0.1:4111', async () => (
    jsonResponse({ error: 'Not found' }, { status: 404, statusText: 'Not Found' })
  )),
  /dev-only/,
)

const freshSnapshot = await snapshotCache.getSnapshot(config)
assert.equal(freshSnapshot.cache?.state, 'fresh')
assert.equal(freshSnapshot.generatedAt, '2026-06-28T00:00:00.000Z')
assert.equal(cacheBuilds, 1)

cacheNow += 20
assert.equal(snapshotCache.getDiagnostics().cache.state, 'stale')
const staleSnapshot = await snapshotCache.getSnapshot(config)
assert.equal(staleSnapshot.cache?.state, 'refreshing')
assert.equal(staleSnapshot.generatedAt, '2026-06-28T00:00:00.000Z')
assert.equal(cacheBuilds, 2)
assert.equal(snapshotCache.getDiagnostics().cache.refreshInFlight, true)
await Promise.resolve()

const refreshedSnapshot = await snapshotCache.getSnapshot(config)
assert.equal(refreshedSnapshot.cache?.state, 'fresh')
assert.equal(refreshedSnapshot.generatedAt, '2026-06-28T00:00:01.000Z')
assert.equal(snapshotCache.getDiagnostics().cache.refreshInFlight, false)

snapshotCache.invalidate()
assert.equal(snapshotCache.getDiagnostics().cache.state, 'empty')
const invalidatedSnapshot = await snapshotCache.getSnapshot(config)
assert.equal(invalidatedSnapshot.cache?.state, 'miss')
assert.equal(invalidatedSnapshot.generatedAt, '2026-06-28T00:00:02.000Z')
assert.equal(cacheBuilds, 3)

console.log('smoke tests passed')

function makeSnapshot(generatedAt: string): LocalSuiteSnapshot {
  return {
    docker: {
      cpu: 0,
      disk: [],
      dockerAvailable: true,
      memMib: 0,
      memoryLimitMib: null,
      publicPortCount: 0,
      publicPortsMessage: 'No matching exposed ports.',
      registryProjectCount: 0,
      runningContainers: 0,
      totalContainers: 0,
    },
    dockerState: {
      ageMs: 0,
      freshForMs: 30_000,
      generatedAt,
      source: 'fresh',
    },
    generatedAt,
    listenerRules: {
      ignored: [],
      ignoredCount: 0,
    },
    listeners: [],
    projects: fixtureProjects,
    roots: [config.developerRoot],
    summary: {
      activeProjects: fixtureProjects.length,
      attentionProjects: 1,
      configuredProjects: config.projects.length,
      dirtyRepos: 0,
      discoveredProjects: 0,
      packageProjects: fixtureProjects.length,
    },
    timing: {
      phases: { test: 1 },
      totalMs: 1,
    },
    warnings: [],
  }
}

function makeProject(input: {
  displayName: string
  dockerPorts: string[]
  id: string
  kind: string
  scripts: string[]
  signals: string[]
  status: ProjectSummary['status']
}): ProjectSummary {
  const pkg = {
    hasWorkspace: false,
    manager: 'pnpm' as const,
    packageName: input.id,
    scripts: input.scripts,
  }
  const targets = getRunTargets(pkg)

  return {
    actions: [],
    displayName: input.displayName,
    docker: {
      composeProject: input.id,
      containers: [],
      cpu: 0,
      heavy: false,
      memMib: 0,
      ports: input.dockerPorts.map((port) => ({
        hostIp: port.split(':')[0] ?? '',
        hostPort: port.split(':')[1] ?? '',
        public: false,
        target: '5432',
      })),
      publicPorts: [],
      registered: true,
      running: input.dockerPorts.length ? 1 : 0,
      safeToStop: true,
    },
    exists: true,
    git: {
      branch: 'main',
      dirtyCount: 0,
      isRepo: true,
      lastCommit: 'abc123 test',
      stagedCount: 0,
      status: 'clean',
      untrackedCount: 0,
    },
    id: input.id,
    kind: input.kind,
    package: {
      ...pkg,
    },
    path: `/tmp/${input.id}`,
    priority: 'active',
    runtime: {
      history: [],
      ownedProcesses: [],
      primaryTarget: targets[0] ?? null,
      status: 'stopped',
      stopReason: 'No project-owned process',
      targets,
    },
    signals: input.signals,
    source: 'configured',
    status: input.status,
    tags: [],
  }
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

async function waitForRegistryEntry(
  registryPath: string,
  entryId: string,
  predicate: (entry: Awaited<ReturnType<typeof readProcessRegistry>>['entries'][number]) => boolean,
) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 5_000) {
    const entry = (await readProcessRegistry(registryPath)).entries.find((candidate) => candidate.entryId === entryId)
    if (entry && predicate(entry)) return entry
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for registry entry: ${entryId}`)
}

function commandResult(command: string, args: string[], stdout: string, exitCode = 0): CommandResult {
  return {
    args,
    command,
    exitCode,
    redacted: false,
    stderr: '',
    stdout,
    timedOut: false,
  }
}

function makeDevctlState(input: { publicPort: boolean }) {
  const port = {
    host_ip: input.publicPort ? '*' : '127.0.0.1',
    host_port: input.publicPort ? '8080' : '55432',
    public: input.publicPort,
    target: input.publicPort ? '3000/tcp' : '5432/tcp',
  }

  return {
    containers: [
      {
        compose_project: 'agentdock',
        cpu: 2,
        health: 'healthy',
        id: 'abc123',
        image: 'postgres:latest',
        mem_mib: 64,
        mem_usage: '64MiB / 1GiB',
        name: 'api',
        ports: [port],
        running: true,
        service: 'api',
        status: 'running',
        working_dir: '/tmp/agentdock',
      },
    ],
    docker_info: { memory_mib: 8_192 },
    projects: {
      agentdock: {
        compose_project: 'agentdock',
        containers: [
          {
            compose_project: 'agentdock',
            cpu: 2,
            health: 'healthy',
            id: 'abc123',
            image: 'postgres:latest',
            mem_mib: 64,
            mem_usage: '64MiB / 1GiB',
            name: 'api',
            ports: [port],
            running: true,
            service: 'api',
            status: 'running',
            working_dir: '/tmp/agentdock',
          },
        ],
        cpu: 2,
        mem_mib: 64,
        ports: [port],
        public_ports: input.publicPort ? [{ ...port, container: 'api' }] : [],
        registry: { heavy: false, name: 'agentdock', safeToStop: false },
        running: 1,
      },
    },
    registry: { projects: [{ name: 'agentdock' }] },
    system_df: [],
  }
}
