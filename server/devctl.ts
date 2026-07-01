import type {
  DockerContainerSummary,
  DockerFleetSummary,
  DockerPort,
  DockerProjectSummary,
  DockerStateInfo,
} from '../src/shared/types.ts'
import type { SuiteConfig } from './config.ts'
import { renderCommand, runCommand, type CommandResult } from './command.ts'

export const DEVCTL_CACHE_FRESH_MS = 30_000

interface RawDockerPort {
  host_ip?: string
  host_port?: string
  target?: string
  public?: boolean
  container?: string
}

interface RawDockerContainer {
  id?: string
  name?: string
  service?: string
  image?: string
  running?: boolean
  status?: string
  health?: string
  cpu?: number
  compose_project?: string
  mem_mib?: number
  mem_usage?: string
  working_dir?: string
  ports?: RawDockerPort[]
}

interface RawDockerProject {
  compose_project?: string
  running?: number
  cpu?: number
  mem_mib?: number
  ports?: RawDockerPort[]
  public_ports?: RawDockerPort[]
  containers?: RawDockerContainer[]
  registry?: {
    name?: string
    safeToStop?: boolean
    heavy?: boolean
  } | null
}

interface RawDevctlState {
  docker_unavailable?: boolean
  containers?: RawDockerContainer[]
  projects?: Record<string, RawDockerProject>
  registry?: { projects?: unknown[] }
  system_df?: Array<Record<string, string>>
  docker_info?: { memory_mib?: number }
}

export interface DevctlState {
  cache: DockerStateInfo
  raw: RawDevctlState | null
  projects: Map<string, DockerProjectSummary>
  byRegistryName: Map<string, DockerProjectSummary>
  fleet: DockerFleetSummary
  warnings: string[]
}

type NormalizedDevctlState = Omit<DevctlState, 'cache'>

interface DevctlCollectorOptions {
  freshMs?: number
  now?: () => number
  run?: (command: string, args: string[], options?: { cwd?: string; timeoutMs?: number; maxOutputChars?: number }) => Promise<CommandResult>
}

interface DevctlCacheEntry {
  completedAtMs: number
  key: string
  state: NormalizedDevctlState
}

export interface DevctlCollector {
  collect: (config: SuiteConfig) => Promise<DevctlState>
  invalidate: () => void
}

function toPort(port: RawDockerPort): DockerPort {
  return {
    hostIp: port.host_ip ?? '',
    hostPort: port.host_port ?? '',
    target: port.target ?? '',
    public: Boolean(port.public),
    container: port.container,
  }
}

function toContainer(container: RawDockerContainer): DockerContainerSummary {
  return {
    id: container.id ?? '',
    name: container.name ?? '',
    service: container.service ?? '',
    image: container.image ?? '',
    running: Boolean(container.running),
    status: container.status ?? 'unknown',
    health: container.health ?? 'unknown',
    cpu: Number(container.cpu ?? 0),
    memMib: Number(container.mem_mib ?? 0),
    memUsage: container.mem_usage ?? '',
    workingDir: container.working_dir ?? '',
    ports: (container.ports ?? []).map(toPort),
  }
}

function formatPublicPort(port: DockerPort): string {
  const hostIp = port.hostIp || '*'
  const target = port.target.split('/', 1)[0] || port.target
  return `${hostIp}:${port.hostPort}->${target}`
}

function publicPortsMessage(raw: RawDevctlState): string {
  if (raw.docker_unavailable) return 'No Docker ports are exposed while Docker Desktop is stopped.'

  const rows: string[] = []
  for (const container of raw.containers ?? []) {
    if (!container.running) continue
    for (const rawPort of container.ports ?? []) {
      const port = toPort(rawPort)
      if (!port.public) continue
      rows.push(`${container.name ?? 'container'} ${container.compose_project ?? 'standalone'} ${formatPublicPort(port)}`)
    }
  }

  return rows.length ? rows.join('\n') : 'No matching exposed ports.'
}

function formatDisk(rows: Array<Record<string, string>> | undefined): string[] {
  if (!rows?.length) return []
  return rows.map((row) => {
    const type = row.Type ?? 'Disk'
    const size = row.Size ?? 'unknown'
    const reclaimable = row.Reclaimable ?? 'unknown'
    return `${type}: ${size}, ${reclaimable} reclaimable`
  })
}

function emptyFleet(publicPortsMessage: string): DockerFleetSummary {
  return {
    dockerAvailable: false,
    runningContainers: 0,
    totalContainers: 0,
    cpu: 0,
    memMib: 0,
    memoryLimitMib: null,
    publicPortCount: 0,
    registryProjectCount: 0,
    disk: [],
    publicPortsMessage,
  }
}

async function collectFreshDevctl(
  config: SuiteConfig,
  run: NonNullable<DevctlCollectorOptions['run']>,
): Promise<NormalizedDevctlState> {
  const status = await run(config.devctlPath, ['--json', 'status'], {
    timeoutMs: 25_000,
    maxOutputChars: 200_000,
  })
  const warnings: string[] = []

  if (status.exitCode !== 0) {
    warnings.push(`devctl status failed: ${status.stderr || status.stdout}`)
    return {
      raw: null,
      projects: new Map(),
      byRegistryName: new Map(),
      fleet: emptyFleet('Public port check unavailable.'),
      warnings,
    }
  }

  let raw: RawDevctlState
  try {
    raw = JSON.parse(status.stdout) as RawDevctlState
  } catch (error) {
    warnings.push(`devctl JSON parse failed: ${error instanceof Error ? error.message : String(error)}`)
    return {
      raw: null,
      projects: new Map(),
      byRegistryName: new Map(),
      fleet: emptyFleet('Public port check unavailable.'),
      warnings,
    }
  }

  const publicPorts = publicPortsMessage(raw)
  const projects = new Map<string, DockerProjectSummary>()
  const byRegistryName = new Map<string, DockerProjectSummary>()

  for (const [composeProject, project] of Object.entries(raw.projects ?? {})) {
    const summary: DockerProjectSummary = {
      composeProject: project.compose_project ?? composeProject,
      registered: Boolean(project.registry),
      safeToStop: Boolean(project.registry?.safeToStop),
      heavy: Boolean(project.registry?.heavy),
      running: Number(project.running ?? 0),
      cpu: Number(project.cpu ?? 0),
      memMib: Number(project.mem_mib ?? 0),
      ports: (project.ports ?? []).map(toPort),
      publicPorts: (project.public_ports ?? []).map(toPort),
      containers: (project.containers ?? []).map(toContainer),
    }
    projects.set(summary.composeProject, summary)
    if (project.registry?.name) {
      byRegistryName.set(project.registry.name, summary)
    }
  }

  const runningContainers = (raw.containers ?? []).filter((container) => container.running)
  const publicPortCount = Array.from(projects.values()).reduce(
    (total, project) => total + project.publicPorts.length,
    0,
  )

  return {
    raw,
    projects,
    byRegistryName,
    fleet: {
      dockerAvailable: !raw.docker_unavailable,
      runningContainers: runningContainers.length,
      totalContainers: (raw.containers ?? []).length,
      cpu: runningContainers.reduce((total, container) => total + Number(container.cpu ?? 0), 0),
      memMib: runningContainers.reduce((total, container) => total + Number(container.mem_mib ?? 0), 0),
      memoryLimitMib: raw.docker_info?.memory_mib ?? null,
      publicPortCount,
      registryProjectCount: raw.registry?.projects?.length ?? 0,
      disk: formatDisk(raw.system_df),
      publicPortsMessage: publicPorts,
    },
    warnings,
  }
}

export function createDevctlCollector(options: DevctlCollectorOptions = {}): DevctlCollector {
  const freshMs = options.freshMs ?? DEVCTL_CACHE_FRESH_MS
  const now = options.now ?? Date.now
  const run = options.run ?? runCommand
  let cache: DevctlCacheEntry | null = null
  let refresh: Promise<DevctlCacheEntry> | null = null
  let refreshKey: string | null = null
  let generation = 0

  const cacheKey = (config: SuiteConfig): string => config.devctlPath
  const isFresh = (entry: DevctlCacheEntry): boolean => now() - entry.completedAtMs <= freshMs
  const withCacheInfo = (entry: DevctlCacheEntry, source: DockerStateInfo['source']): DevctlState => ({
    ...entry.state,
    cache: {
      ageMs: Math.max(0, Math.round(now() - entry.completedAtMs)),
      freshForMs: freshMs,
      generatedAt: new Date(entry.completedAtMs).toISOString(),
      source,
    },
  })

  return {
    async collect(config: SuiteConfig): Promise<DevctlState> {
      const key = cacheKey(config)
      if (cache?.key === key && isFresh(cache)) return withCacheInfo(cache, 'cached')
      if (refresh && refreshKey === key) return withCacheInfo(await refresh, 'fresh')

      refreshKey = key
      const refreshGeneration = generation
      const currentRefresh = collectFreshDevctl(config, run)
        .then((state) => {
          const entry = { completedAtMs: now(), key, state }
          if (refreshGeneration === generation) {
            cache = entry
          }
          return entry
        })
        .finally(() => {
          if (refresh === currentRefresh) {
            refresh = null
            refreshKey = null
          }
        })
      refresh = currentRefresh

      return withCacheInfo(await currentRefresh, 'fresh')
    },

    invalidate(): void {
      generation += 1
      cache = null
      refresh = null
      refreshKey = null
    },
  }
}

const devctlCollector = createDevctlCollector()

export async function collectDevctl(config: SuiteConfig): Promise<DevctlState> {
  return devctlCollector.collect(config)
}

export function invalidateDevctlCache(): void {
  devctlCollector.invalidate()
}

export async function runDevctlActionPreview(
  config: SuiteConfig,
  args: string[],
): Promise<{ command: string; exitCode: number; stdout: string; stderr: string; redacted: boolean }> {
  const result = await runCommand(config.devctlPath, args, {
    timeoutMs: 20_000,
    maxOutputChars: 40_000,
  })

  return {
    command: renderCommand(config.devctlPath, args),
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    redacted: result.redacted,
  }
}
