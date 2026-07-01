import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import type {
  DockerProjectSummary,
  GitSummary,
  ListenerPort,
  LocalSuiteSnapshot,
  PackageSummary,
  ProjectRuntimeHistoryEntry,
  ProjectRuntimeProcess,
  ProjectRuntimeSummary,
  ProjectConfig,
  ProjectStatus,
  ProjectSummary,
  SafeAction,
} from '../src/shared/types.ts'
import { listenerRuleKey } from '../src/shared/listenerRules.ts'
import { getRunTargets } from '../src/shared/runTargets.ts'
import type { SuiteConfig } from './config.ts'
import { runCommand } from './command.ts'
import { collectDevctl, type DevctlState } from './devctl.ts'
import { applyListenerRulesToListeners, readListenerRules, summarizeListenerRules } from './listenerRules.ts'
import {
  readProcessRegistrySnapshot,
  registryHistoryForProject,
  registryRuntimeProcessesForProject,
} from './processRegistry.ts'

const IGNORE_DIRS = new Set([
  '.Trash',
  'Applications',
  'Desktop',
  'Documents',
  'Downloads',
  'Library',
  'Movies',
  'Music',
  'Pictures',
  'Public',
  'node_modules',
])

async function timePhase<T>(
  phases: Record<string, number>,
  name: string,
  work: () => Promise<T>,
): Promise<T> {
  const start = performance.now()
  try {
    return await work()
  } finally {
    phases[name] = Math.round(performance.now() - start)
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

function pathExistsSync(target: string): boolean {
  return fsSync.existsSync(target)
}

async function readJsonFile<T>(target: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(target, 'utf8')) as T
  } catch {
    return null
  }
}

function projectIdFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function packageManagerFor(projectPath: string): PackageSummary['manager'] {
  if (pathExistsSync(path.join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm'
  if (pathExistsSync(path.join(projectPath, 'package-lock.json'))) return 'npm'
  if (pathExistsSync(path.join(projectPath, 'yarn.lock'))) return 'yarn'
  if (pathExistsSync(path.join(projectPath, 'bun.lockb')) || pathExistsSync(path.join(projectPath, 'bun.lock'))) return 'bun'
  return 'unknown'
}

export async function readPackageSummary(projectPath: string): Promise<PackageSummary | null> {
  const packageJsonPath = path.join(projectPath, 'package.json')
  const packageJson = await readJsonFile<{ name?: string; scripts?: Record<string, string> }>(packageJsonPath)
  if (!packageJson) return null

  return {
    packageName: packageJson.name ?? null,
    manager: packageManagerFor(projectPath),
    hasWorkspace: await pathExists(path.join(projectPath, 'pnpm-workspace.yaml')),
    scripts: Object.keys(packageJson.scripts ?? {}).sort(),
  }
}

async function readGitSummary(projectPath: string): Promise<GitSummary> {
  if (!(await pathExists(path.join(projectPath, '.git')))) {
    return {
      isRepo: false,
      branch: null,
      dirtyCount: 0,
      stagedCount: 0,
      untrackedCount: 0,
      lastCommit: null,
      status: 'not-repo',
    }
  }

  const branch = await runCommand('git', ['-C', projectPath, 'branch', '--show-current'], {
    timeoutMs: 8_000,
    maxOutputChars: 10_000,
  })
  const porcelain = await runCommand('git', ['-C', projectPath, 'status', '--porcelain=v1'], {
    timeoutMs: 10_000,
    maxOutputChars: 40_000,
  })
  const lastCommit = await runCommand('git', ['-C', projectPath, 'log', '-1', '--format=%h %s'], {
    timeoutMs: 8_000,
    maxOutputChars: 12_000,
  })

  if (branch.exitCode !== 0 || porcelain.exitCode !== 0) {
    return {
      isRepo: true,
      branch: null,
      dirtyCount: 0,
      stagedCount: 0,
      untrackedCount: 0,
      lastCommit: null,
      status: 'error',
    }
  }

  const changed = porcelain.stdout.split('\n').filter((line) => line.trim().length > 0)
  const stagedCount = changed.filter((line) => line[0] !== ' ' && line[0] !== '?').length
  const untrackedCount = changed.filter((line) => line.startsWith('??')).length

  return {
    isRepo: true,
    branch: branch.stdout.trim() || null,
    dirtyCount: changed.length,
    stagedCount,
    untrackedCount,
    lastCommit: lastCommit.exitCode === 0 ? lastCommit.stdout.trim() || null : null,
    status: changed.length > 0 ? 'dirty' : 'clean',
  }
}

export async function discoverRootProjects(developerRoot: string): Promise<ProjectConfig[]> {
  const entries = await fs.readdir(developerRoot, { withFileTypes: true })
  const projects: ProjectConfig[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || IGNORE_DIRS.has(entry.name)) continue
    const projectPath = path.join(developerRoot, entry.name)
    const hasProjectSignal = await Promise.all([
      pathExists(path.join(projectPath, '.git')),
      pathExists(path.join(projectPath, 'package.json')),
      pathExists(path.join(projectPath, 'compose.yml')),
      pathExists(path.join(projectPath, 'compose.yaml')),
      pathExists(path.join(projectPath, 'docker-compose.yml')),
    ])
    if (!hasProjectSignal.some(Boolean)) continue

    projects.push({
      id: projectIdFromName(entry.name),
      displayName: entry.name,
      path: projectPath,
      kind: 'repo',
      priority: 'watch',
      tags: [],
    })
  }

  return projects
}

export async function resolveProjectById(config: SuiteConfig, projectId: string): Promise<ProjectConfig | null> {
  const configuredProject = config.projects.find((project) => project.id === projectId)
  if (configuredProject) return configuredProject

  const discoveredProjects = await discoverRootProjects(config.developerRoot)
  return discoveredProjects.find((project) => project.id === projectId) ?? null
}

function dockerFor(project: ProjectConfig, devctl: DevctlState): DockerProjectSummary | null {
  if (project.devctlProject) {
    const byName = devctl.byRegistryName.get(project.devctlProject)
    if (byName) return byName
  }

  if (project.composeProject) {
    const byCompose = devctl.projects.get(project.composeProject)
    if (byCompose) return byCompose
  }

  const projectPath = path.resolve(project.path)
  for (const dockerProject of devctl.projects.values()) {
    const hasProjectPath = dockerProject.containers.some((container) => {
      if (!container.workingDir) return false
      const workingDir = path.resolve(container.workingDir)
      return workingDir === projectPath || workingDir.startsWith(`${projectPath}${path.sep}`)
    })
    if (hasProjectPath) return dockerProject
  }

  return null
}

function actionsFor(project: ProjectConfig, hasDocker: boolean, runtime: ProjectRuntimeSummary): SafeAction[] {
  const canPreview = Boolean(project.devctlProject)
  const canStart = Boolean(runtime.primaryTarget)
  const canStop = runtime.ownedProcesses.length > 0

  return [
    {
      id: 'script-start',
      label: runtime.primaryTarget?.label ?? 'Start dev',
      kind: 'terminal',
      disabled: !canStart,
      reason: runtime.primaryTarget ? `Open Ghostty / ${runtime.primaryTarget.commandLabel}` : 'No runnable script',
    },
    {
      id: 'script-stop',
      label: 'Stop dev',
      kind: 'process',
      disabled: !canStop,
      reason: canStop ? runtime.stopReason : 'No project-owned process',
    },
    {
      id: 'devctl-up-preview',
      label: 'Preview up',
      kind: 'preview',
      disabled: !canPreview,
      reason: canPreview ? 'Docker dry run' : 'No devctl project',
    },
    {
      id: 'devctl-down-preview',
      label: 'Preview down',
      kind: 'preview',
      disabled: !canPreview,
      reason: canPreview ? 'Docker dry run' : 'No devctl project',
    },
    {
      id: 'docker-doctor',
      label: 'Docker doctor',
      kind: 'read',
      disabled: false,
      reason: 'Read-only',
    },
    {
      id: 'stop-candidates',
      label: 'Stop candidates',
      kind: 'read',
      disabled: !hasDocker,
      reason: hasDocker ? 'Read-only' : 'No Docker state',
    },
  ]
}

function runtimeForProject(
  pkg: PackageSummary | null,
  listeners: ListenerPort[] = [],
  registryProcesses: ProjectRuntimeProcess[] = [],
  history: ProjectRuntimeHistoryEntry[] = [],
): ProjectRuntimeSummary {
  const targets = getRunTargets(pkg)
  const listenerProcesses = listeners
    .filter((listener): listener is ListenerPort & { pid: number } => (
      listener.pid !== null && listener.projectMatch === 'process-cwd'
    ))
    .map((listener): ProjectRuntimeProcess => ({
      bindIp: listener.bindIp,
      command: listener.command,
      pid: listener.pid,
      port: listener.port,
      scope: listener.scope,
      source: 'listener',
    }))
  const ownedProcesses = [...listenerProcesses, ...registryProcesses]

  const uniqueProcessCount = new Set(ownedProcesses.map((process) => process.pid)).size

  return {
    history,
    ownedProcesses,
    primaryTarget: targets[0] ?? null,
    status: ownedProcesses.length ? 'running' : 'stopped',
    stopReason: ownedProcesses.length
      ? `${uniqueProcessCount} owned process${uniqueProcessCount === 1 ? '' : 'es'}`
      : 'No project-owned process',
    targets,
  }
}

function statusFor(
  exists: boolean,
  git: GitSummary,
  docker: DockerProjectSummary | null,
  pkg: PackageSummary | null,
): ProjectStatus {
  if (!exists || git.status === 'error') return 'attention'
  if (docker?.publicPorts.length) return 'attention'
  if (docker?.heavy && docker.memMib >= 1024) return 'attention'
  if (git.dirtyCount > 0) return 'attention'
  if (docker?.running || pkg) return 'ready'
  return 'idle'
}

function signalsFor(
  exists: boolean,
  git: GitSummary,
  docker: DockerProjectSummary | null,
  pkg: PackageSummary | null,
): string[] {
  const signals: string[] = []
  if (!exists) signals.push('Missing path')
  if (git.status === 'dirty') signals.push(`${git.dirtyCount} git change${git.dirtyCount === 1 ? '' : 's'}`)
  if (git.status === 'error') signals.push('Git status failed')
  if (docker?.heavy && docker.memMib >= 1024) signals.push('Heavy Docker stack')
  if (docker?.publicPorts.length) signals.push('Public Docker port')
  if (docker?.running) signals.push(`${docker.running} container${docker.running === 1 ? '' : 's'} running`)
  if (pkg?.scripts.includes('dev')) signals.push('Has dev script')
  if (signals.length === 0) signals.push('No active signal')
  return signals
}

export function parseListeners(output: string, localSuitePid = process.pid): ListenerPort[] {
  const rows = output.split('\n').slice(1)
  const listeners: ListenerPort[] = []

  for (const row of rows) {
    const match = row.match(/^(\S+)\s+(\d+)\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+TCP\s+(.+)\s+\(LISTEN\)$/)
    if (!match) continue
    const [, command = '', pid = '', address = ''] = match
    const portMatch = address.match(/(.+):(\d+)$/)
    if (!portMatch) continue
    const numericPid = Number(pid)
    const bindIp = portMatch[1] ?? ''
    const scope = bindIp === '*' || bindIp === '0.0.0.0' || bindIp === '[::]'
      ? 'public'
      : bindIp.includes('127.0.0.1') || bindIp === 'localhost'
        ? 'local'
        : 'unknown'

    listeners.push({
      command,
      pid: numericPid,
      bindIp,
      port: portMatch[2] ?? '',
      scope,
      owner: numericPid === localSuitePid ? 'local-suite' : 'external',
      projectId: null,
      projectMatch: null,
      ruleKey: listenerRuleKey({
        bindIp,
        command,
        port: portMatch[2] ?? '',
        scope,
      }),
      classification: null,
      classificationReason: null,
    })
  }

  return listeners
}

export function parseListenerCwdOutput(output: string): Map<number, string> {
  const cwds = new Map<number, string>()
  let currentPid: number | null = null

  for (const line of output.split('\n')) {
    if (line.startsWith('p')) {
      const parsedPid = Number(line.slice(1))
      currentPid = Number.isInteger(parsedPid) ? parsedPid : null
      continue
    }

    if (currentPid !== null && line.startsWith('n')) {
      const cwd = line.slice(1).trim()
      if (cwd) cwds.set(currentPid, cwd)
    }
  }

  return cwds
}

async function readListenerCwds(listeners: ListenerPort[]): Promise<Map<number, string>> {
  const pids = Array.from(
    new Set(
      listeners
        .map((listener) => listener.pid)
        .filter((pid): pid is number => pid !== null && Number.isInteger(pid) && pid > 0),
    ),
  ).slice(0, 200)

  if (!pids.length) return new Map()

  const result = await runCommand('lsof', ['-nP', '-a', '-d', 'cwd', '-p', pids.join(','), '-Fpn'], {
    timeoutMs: 8_000,
    maxOutputChars: 60_000,
  })

  return parseListenerCwdOutput(result.stdout)
}

export async function findRuntimeProcessesForProject(projectPath: string): Promise<ProjectRuntimeProcess[]> {
  const listeners = await collectListeners()
  const processCwds = await readListenerCwds(listeners)
  const resolvedProjectPath = path.resolve(projectPath)

  return listeners
    .filter((listener): listener is ListenerPort & { pid: number } => {
      if (listener.pid === null || listener.owner === 'local-suite') return false
      const cwd = processCwds.get(listener.pid)
      if (!cwd) return false
      const resolvedCwd = path.resolve(cwd)
      return resolvedCwd === resolvedProjectPath || resolvedCwd.startsWith(`${resolvedProjectPath}${path.sep}`)
    })
    .map((listener) => ({
      bindIp: listener.bindIp,
      command: listener.command,
      pid: listener.pid,
      port: listener.port,
      scope: listener.scope,
    }))
}

export function correlateListenersToProjects(
  listeners: ListenerPort[],
  projects: ProjectSummary[],
  processCwds: Map<number, string> = new Map(),
): ListenerPort[] {
  const localSuiteProject = projects.find((project) => project.id === 'local-suite') ?? null
  const dockerIndex = buildDockerPortIndex(projects)

  return listeners.map((listener) => {
    const localSuiteMatch = listener.owner === 'local-suite' ? localSuiteProject?.id ?? null : null
    if (localSuiteMatch) {
      return {
        ...listener,
        projectId: localSuiteMatch,
        projectMatch: 'local-suite',
      }
    }

    const dockerMatch = findDockerPortProject(listener, dockerIndex)
    if (dockerMatch) {
      return {
        ...listener,
        projectId: dockerMatch,
        projectMatch: 'docker-port',
      }
    }

    const cwd = listener.pid === null ? null : processCwds.get(listener.pid) ?? null
    const cwdMatch = cwd ? findProjectForPath(projects, cwd)?.id ?? null : null
    if (cwdMatch) {
      return {
        ...listener,
        projectId: cwdMatch,
        projectMatch: 'process-cwd',
      }
    }

    return listener
  })
}

interface DockerPortIndex {
  exact: Map<string, string | null>
  byPort: Map<string, string | null>
}

function buildDockerPortIndex(projects: ProjectSummary[]): DockerPortIndex {
  const exact = new Map<string, string | null>()
  const byPort = new Map<string, string | null>()

  for (const project of projects) {
    for (const dockerPort of project.docker?.ports ?? []) {
      if (!dockerPort.hostPort) continue
      setUniqueIndexValue(exact, `${normalizeBindIp(dockerPort.hostIp)}:${dockerPort.hostPort}`, project.id)
      setUniqueIndexValue(byPort, dockerPort.hostPort, project.id)
    }
  }

  return { exact, byPort }
}

function setUniqueIndexValue(index: Map<string, string | null>, key: string, value: string): void {
  const existing = index.get(key)
  if (existing === undefined || existing === value) {
    index.set(key, value)
    return
  }
  index.set(key, null)
}

function findDockerPortProject(listener: ListenerPort, index: DockerPortIndex): string | null {
  const exactMatch = index.exact.get(`${normalizeBindIp(listener.bindIp)}:${listener.port}`)
  if (exactMatch !== undefined) return exactMatch

  const portMatch = index.byPort.get(listener.port)
  return portMatch ?? null
}

function findProjectForPath(projects: ProjectSummary[], cwd: string): ProjectSummary | null {
  const resolvedCwd = path.resolve(cwd)
  const matches = projects.filter((project) => {
    const projectPath = path.resolve(project.path)
    return resolvedCwd === projectPath || resolvedCwd.startsWith(`${projectPath}${path.sep}`)
  })

  return matches.sort((left, right) => right.path.length - left.path.length)[0] ?? null
}

function normalizeBindIp(bindIp: string): string {
  if (!bindIp || bindIp === '*' || bindIp === '0.0.0.0' || bindIp === '::' || bindIp === '[::]') return '*'
  if (bindIp === 'localhost' || bindIp === '[::1]') return '127.0.0.1'
  return bindIp
}

async function collectListeners(): Promise<ListenerPort[]> {
  const result = await runCommand('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], {
    timeoutMs: 10_000,
    maxOutputChars: 80_000,
  })
  if (result.exitCode !== 0) return []
  return parseListeners(result.stdout).slice(0, 200)
}

export async function buildSnapshot(config: SuiteConfig): Promise<LocalSuiteSnapshot> {
  const startedAt = performance.now()
  const phases: Record<string, number> = {}
  const [devctl, discoveredProjects, listeners, listenerRules, registrySnapshot] = await Promise.all([
    timePhase(phases, 'devctl', () => collectDevctl(config)),
    timePhase(phases, 'discoverProjects', () => discoverRootProjects(config.developerRoot)),
    timePhase(phases, 'listeners', collectListeners),
    timePhase(phases, 'listenerRules', readListenerRules),
    timePhase(phases, 'processRegistry', () => readProcessRegistrySnapshot()),
  ])

  const configuredByPath = new Map(config.projects.map((project) => [path.resolve(project.path), project]))
  const projects: ProjectConfig[] = [...config.projects]

  for (const discovered of discoveredProjects) {
    if (configuredByPath.has(path.resolve(discovered.path))) continue
    projects.push(discovered)
  }

  const summaries = await timePhase(phases, 'projectSummaries', () => Promise.all(projects.map(async (project): Promise<ProjectSummary> => {
    const exists = await pathExists(project.path)
    const [git, pkg] = exists
      ? await Promise.all([readGitSummary(project.path), readPackageSummary(project.path)])
      : [
          {
            isRepo: false,
            branch: null,
            dirtyCount: 0,
            stagedCount: 0,
            untrackedCount: 0,
            lastCommit: null,
            status: 'not-repo' as const,
          },
          null,
        ]
    const docker = dockerFor(project, devctl)
    const status = statusFor(exists, git, docker, pkg)

    return {
      id: project.id,
      displayName: project.displayName,
      path: project.path,
      kind: project.kind,
      priority: project.priority,
      tags: project.tags,
      source: config.projects.some((configured) => configured.id === project.id) ? 'configured' : 'discovered',
      exists,
      status,
      signals: signalsFor(exists, git, docker, pkg),
      git,
      package: pkg,
      runtime: runtimeForProject(
        pkg,
        [],
        registryRuntimeProcessesForProject(project, registrySnapshot.activeEntries),
        registryHistoryForProject(project, registrySnapshot.entries),
      ),
      docker,
      actions: [],
    }
  })))

  const sortedProjects = summaries.sort((a, b) => {
    const priorityRank = { active: 0, watch: 1, archive: 2 }
    const statusRank = { attention: 0, ready: 1, idle: 2, unknown: 3 }
    return (
      priorityRank[a.priority] - priorityRank[b.priority]
      || statusRank[a.status] - statusRank[b.status]
      || a.displayName.localeCompare(b.displayName)
    )
  })
  const listenerCwds = await timePhase(phases, 'listenerCwds', () => readListenerCwds(listeners))
  const classifiedListeners = await timePhase(phases, 'listenerCorrelation', async () => {
    const correlatedListeners = correlateListenersToProjects(listeners, sortedProjects, listenerCwds)
    return applyListenerRulesToListeners(correlatedListeners, listenerRules)
  })
  const projectsWithRuntime = sortedProjects.map((project) => {
    const projectConfig = projects.find((candidate) => candidate.id === project.id) ?? {
      id: project.id,
      displayName: project.displayName,
      path: project.path,
      kind: project.kind,
      priority: project.priority,
      tags: project.tags,
    }
    const runtime = runtimeForProject(
      project.package,
      classifiedListeners.filter((listener) => listener.projectId === project.id),
      registryRuntimeProcessesForProject(projectConfig, registrySnapshot.activeEntries),
      registryHistoryForProject(projectConfig, registrySnapshot.entries),
    )

    return {
      ...project,
      runtime,
      actions: actionsFor(projectConfig, Boolean(project.docker), runtime),
    }
  })

  return {
    generatedAt: new Date().toISOString(),
    roots: [config.developerRoot],
    summary: {
      configuredProjects: config.projects.length,
      discoveredProjects: projectsWithRuntime.filter((project) => project.source === 'discovered').length,
      activeProjects: projectsWithRuntime.filter((project) => project.priority === 'active').length,
      attentionProjects: projectsWithRuntime.filter((project) => project.status === 'attention').length,
      dirtyRepos: projectsWithRuntime.filter((project) => project.git.status === 'dirty').length,
      packageProjects: projectsWithRuntime.filter((project) => project.package).length,
    },
    docker: devctl.fleet,
    projects: projectsWithRuntime,
    listeners: classifiedListeners,
    listenerRules: summarizeListenerRules(listenerRules),
    dockerState: devctl.cache,
    timing: {
      totalMs: Math.round(performance.now() - startedAt),
      phases,
    },
    warnings: devctl.warnings,
  }
}
