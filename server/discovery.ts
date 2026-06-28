import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  DockerProjectSummary,
  GitSummary,
  ListenerPort,
  LocalSuiteSnapshot,
  PackageSummary,
  ProjectConfig,
  ProjectStatus,
  ProjectSummary,
  SafeAction,
} from '../src/shared/types.ts'
import type { SuiteConfig } from './config.ts'
import { runCommand } from './command.ts'
import { collectDevctl, type DevctlState } from './devctl.ts'

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

async function readPackageSummary(projectPath: string): Promise<PackageSummary | null> {
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

async function discoverRootProjects(developerRoot: string): Promise<ProjectConfig[]> {
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

function actionsFor(project: ProjectConfig, hasDocker: boolean): SafeAction[] {
  const canPreview = Boolean(project.devctlProject)

  return [
    {
      id: 'devctl-up-preview',
      label: 'Preview up',
      kind: 'preview',
      disabled: !canPreview,
      reason: canPreview ? 'Dry run only' : 'No devctl project',
    },
    {
      id: 'devctl-down-preview',
      label: 'Preview down',
      kind: 'preview',
      disabled: !canPreview,
      reason: canPreview ? 'Dry run only' : 'No devctl project',
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

function parseListeners(output: string): ListenerPort[] {
  const rows = output.split('\n').slice(1)
  const listeners: ListenerPort[] = []

  for (const row of rows) {
    const match = row.match(/^(\S+)\s+(\d+)\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+TCP\s+(.+)\s+\(LISTEN\)$/)
    if (!match) continue
    const [, command = '', pid = '', address = ''] = match
    const portMatch = address.match(/(.+):(\d+)$/)
    if (!portMatch) continue
    const bindIp = portMatch[1] ?? ''
    const scope = bindIp === '*' || bindIp === '0.0.0.0' || bindIp === '[::]'
      ? 'public'
      : bindIp.includes('127.0.0.1') || bindIp === 'localhost'
        ? 'local'
        : 'unknown'

    listeners.push({
      command,
      pid: Number(pid),
      bindIp,
      port: portMatch[2] ?? '',
      scope,
    })
  }

  return listeners
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
  const [devctl, discoveredProjects, listeners] = await Promise.all([
    collectDevctl(config),
    discoverRootProjects(config.developerRoot),
    collectListeners(),
  ])

  const configuredByPath = new Map(config.projects.map((project) => [path.resolve(project.path), project]))
  const projects: ProjectConfig[] = [...config.projects]

  for (const discovered of discoveredProjects) {
    if (configuredByPath.has(path.resolve(discovered.path))) continue
    projects.push(discovered)
  }

  const summaries = await Promise.all(projects.map(async (project): Promise<ProjectSummary> => {
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
      docker,
      actions: actionsFor(project, Boolean(docker)),
    }
  }))

  const sortedProjects = summaries.sort((a, b) => {
    const priorityRank = { active: 0, watch: 1, archive: 2 }
    const statusRank = { attention: 0, ready: 1, idle: 2, unknown: 3 }
    return (
      priorityRank[a.priority] - priorityRank[b.priority]
      || statusRank[a.status] - statusRank[b.status]
      || a.displayName.localeCompare(b.displayName)
    )
  })

  return {
    generatedAt: new Date().toISOString(),
    roots: [config.developerRoot],
    summary: {
      configuredProjects: config.projects.length,
      discoveredProjects: sortedProjects.filter((project) => project.source === 'discovered').length,
      activeProjects: sortedProjects.filter((project) => project.priority === 'active').length,
      attentionProjects: sortedProjects.filter((project) => project.status === 'attention').length,
      dirtyRepos: sortedProjects.filter((project) => project.git.status === 'dirty').length,
      packageProjects: sortedProjects.filter((project) => project.package).length,
    },
    docker: devctl.fleet,
    projects: sortedProjects,
    listeners,
    warnings: devctl.warnings,
  }
}
