import path from 'node:path'
import { z } from 'zod'
import { SAFE_ACTION_IDS, type ActionResult, type ProjectRuntimeProcess, type SafeAction } from '../src/shared/types.ts'
import {
  getPrimaryRunTarget,
  getRunTargetById,
} from '../src/shared/runTargets.ts'
import { redactSecrets, renderCommand, runCommand, type CommandResult } from './command.ts'
import { getRepoRoot, type SuiteConfig } from './config.ts'
import { runDevctlActionPreview } from './devctl.ts'
import { findRuntimeProcessesForProject, readPackageSummary, resolveProjectById } from './discovery.ts'
import {
  createProcessRegistryEntry,
  defaultProcessRegistryPath,
  markProcessRegistryExited,
  markProcessRegistryStopRequested,
  readActiveProcessRegistryEntries,
  registryRuntimeProcessesForProject,
  type ProcessRegistryOptions,
} from './processRegistry.ts'

export const actionRequestSchema = z.object({
  actionId: z.enum(SAFE_ACTION_IDS),
  projectId: z.string().min(1).optional(),
  targetId: z.string().min(1).optional(),
})

interface SafeActionDependencies {
  findRuntimeProcesses?: (projectPath: string) => Promise<ProjectRuntimeProcess[]>
  ghosttyAppName?: string
  isProcessAlive?: ProcessRegistryOptions['isProcessAlive']
  now?: ProcessRegistryOptions['now']
  processRegistryPath?: string
  run?: typeof runCommand
}

export async function runSafeAction(
  config: SuiteConfig,
  input: z.infer<typeof actionRequestSchema>,
  dependencies: SafeActionDependencies = {},
): Promise<ActionResult> {
  if (input.targetId && input.actionId !== 'script-start') {
    throw new Error('Run target only applies to start.')
  }

  const project = input.projectId ? await resolveProjectById(config, input.projectId) : null

  if (input.actionId === 'script-start') {
    if (!project) throw new Error('Project is required.')
    return await runScriptStartAction(config, project, input.actionId, input.targetId, dependencies)
  }

  if (input.actionId === 'script-stop') {
    if (!project) throw new Error('Project is required.')
    return await runScriptStopAction(project, input.actionId, dependencies)
  }

  const args = argsForAction(input.actionId, project?.devctlProject)
  const result = await runDevctlActionPreview(config, args)

  return {
    actionId: input.actionId,
    projectId: input.projectId ?? null,
    command: result.command,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    redacted: result.redacted,
    generatedAt: new Date().toISOString(),
  }
}

function argsForAction(actionId: SafeAction['id'], devctlProject?: string): string[] {
  if (actionId === 'docker-doctor') return ['doctor']
  if (actionId === 'stop-candidates') return ['stop-idle']
  if (!devctlProject) {
    throw new Error('This project is not registered with devctl.')
  }
  if (actionId === 'devctl-up-preview') return ['up', devctlProject]
  if (actionId === 'devctl-down-preview') return ['down', devctlProject]
  throw new Error(`Unsupported action: ${actionId}`)
}

async function runScriptStartAction(
  config: SuiteConfig,
  project: Awaited<ReturnType<typeof resolveProjectById>>,
  actionId: SafeAction['id'],
  targetId: string | undefined,
  dependencies: SafeActionDependencies,
): Promise<ActionResult> {
  if (!project) throw new Error('Project is required.')
  const pkg = await readPackageSummary(project.path)
  const target = targetId ? getRunTargetById(pkg, targetId) : getPrimaryRunTarget(pkg)
  if (targetId && !target) throw new Error('Run target not found.')
  if (!target) throw new Error('No runnable script was found.')

  const run = dependencies.run ?? runCommand
  const ghosttyAppName = dependencies.ghosttyAppName ?? 'Ghostty.app'
  const registryPath = dependencies.processRegistryPath ?? defaultProcessRegistryPath()
  const registryEntry = await createProcessRegistryEntry({ project, target }, {
    now: dependencies.now,
    registryPath,
  })
  const terminalArgs = ghosttyLaunchArgs(project.path, processRunnerArgs({
    entryId: registryEntry.entryId,
    projectPath: project.path,
    registryPath,
    target,
  }))
  const args = ['-na', ghosttyAppName, '--args', ...terminalArgs]
  const result = await run('/usr/bin/open', args, {
    cwd: config.developerRoot,
    timeoutMs: 10_000,
    maxOutputChars: 20_000,
  })
  if (result.exitCode !== 0) {
    await markProcessRegistryExited(registryEntry.entryId, {
      exitCode: result.exitCode,
      signal: null,
      status: 'failed',
    }, {
      now: dependencies.now,
      registryPath,
    })
  }
  const fallbackOutput = result.exitCode === 0
    ? `Opened Ghostty with ${target.commandLabel}.`
    : ''

  return actionResultFromCommand({
    actionId,
    projectId: project.id,
    result,
    renderedCommand: renderCommand('/usr/bin/open', args),
    stdout: result.stdout || fallbackOutput,
  })
}

async function runScriptStopAction(
  project: Awaited<ReturnType<typeof resolveProjectById>>,
  actionId: SafeAction['id'],
  dependencies: SafeActionDependencies,
): Promise<ActionResult> {
  if (!project) throw new Error('Project is required.')
  const findProcesses = dependencies.findRuntimeProcesses ?? findRuntimeProcessesForProject
  const registryPath = dependencies.processRegistryPath ?? defaultProcessRegistryPath()
  const [listenerProcesses, registryEntries] = await Promise.all([
    findProcesses(project.path),
    readActiveProcessRegistryEntries({
      isProcessAlive: dependencies.isProcessAlive,
      registryPath,
    }),
  ])
  const registryProcesses = registryRuntimeProcessesForProject(project, registryEntries, dependencies.isProcessAlive)
  const processes = [...listenerProcesses, ...registryProcesses]
  const processGroupPids = new Set(
    registryProcesses
      .map((process) => process.processGroupPid)
      .filter((pid): pid is number => typeof pid === 'number'),
  )
  const pids = Array.from(new Set(processes.map((process) => process.pid))).sort((left, right) => left - right)

  if (!pids.length) {
    throw new Error('No project-owned process was found.')
  }

  const run = dependencies.run ?? runCommand
  const directPids = pids.filter((pid) => !processGroupPids.has(pid))
  const args = [
    '-TERM',
    ...Array.from(processGroupPids).sort((left, right) => left - right).map((pid) => `-${pid}`),
    ...directPids.map(String),
  ]
  const result = await run('/bin/kill', args, {
    timeoutMs: 10_000,
    maxOutputChars: 20_000,
  })
  const stoppedRegistryIds = registryProcesses
    .map((process) => process.registryId)
    .filter((registryId): registryId is string => typeof registryId === 'string')
  await markProcessRegistryStopRequested(stoppedRegistryIds, {
    exitCode: result.exitCode,
    signal: 'SIGTERM',
  }, {
    now: dependencies.now,
    registryPath,
  })
  const fallbackOutput = result.exitCode === 0
    ? `Sent SIGTERM to ${pids.length} process${pids.length === 1 ? '' : 'es'}.`
    : ''

  return actionResultFromCommand({
    actionId,
    projectId: project.id,
    result,
    renderedCommand: renderCommand('/bin/kill', args),
    stdout: result.stdout || fallbackOutput,
  })
}

function processRunnerArgs(input: {
  entryId: string
  projectPath: string
  registryPath: string
  target: NonNullable<ReturnType<typeof getPrimaryRunTarget>>
}): { args: string[]; command: string } {
  return {
    args: [
      runnerScriptPath(),
      '--registry',
      input.registryPath,
      '--entry-id',
      input.entryId,
      '--project-path',
      input.projectPath,
      '--manager',
      input.target.manager,
      '--script',
      input.target.script,
      '--command-label',
      input.target.commandLabel,
    ],
    command: pathToTsx(),
  }
}

function ghosttyLaunchArgs(projectPath: string, runner: { args: string[]; command: string }): string[] {
  const commandText = renderCommand(runner.command, runner.args)
  const shellCommand = [
    `cd ${shellQuote(projectPath)}`,
    commandText,
    'printf "\\nProcess exited with status %s. Press Ctrl-D to close.\\n" "$?"',
    'exec /bin/zsh -l',
  ].join('; ')

  return [
    `--working-directory=${projectPath}`,
    '-e',
    '/bin/zsh',
    '-lc',
    shellCommand,
  ]
}

function pathToTsx(): string {
  return path.join(getRepoRoot(), 'node_modules', '.bin', 'tsx')
}

function runnerScriptPath(): string {
  return path.join(getRepoRoot(), 'scripts', 'run-target-runner.ts')
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}

function actionResultFromCommand(input: {
  actionId: SafeAction['id']
  projectId: string
  renderedCommand: string
  result: CommandResult
  stdout: string
}): ActionResult {
  const stdout = redactSecrets(input.stdout)
  const stderr = redactSecrets(input.result.stderr)

  return {
    actionId: input.actionId,
    projectId: input.projectId,
    command: input.renderedCommand,
    exitCode: input.result.exitCode,
    stdout: stdout.value,
    stderr: stderr.value,
    redacted: input.result.redacted || stdout.redacted || stderr.redacted,
    generatedAt: new Date().toISOString(),
  }
}
