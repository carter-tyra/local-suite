import { pathToFileURL } from 'node:url'
import type { SnapshotDiagnostics } from '../src/shared/types.ts'

const DEFAULT_BASE_URL = 'http://127.0.0.1:4111'
const DIAGNOSTICS_PATH = 'api/dev/snapshot-diagnostics'
const REFRESH_DOCKER_PATH = 'api/dev/snapshot-diagnostics/refresh-docker'
const SNAPSHOT_PATH = 'api/snapshot'
const USAGE = `Usage: pnpm diag:snapshot [--warm | --refresh-docker] [--url ${DEFAULT_BASE_URL}]`

interface CliOptions {
  baseUrl: string
  help: boolean
  refreshDocker: boolean
  warm: boolean
}

export function diagnosticsEndpoint(baseUrl: string): string {
  return endpointUrl(baseUrl, DIAGNOSTICS_PATH)
}

export function refreshDockerEndpoint(baseUrl: string): string {
  return endpointUrl(baseUrl, REFRESH_DOCKER_PATH)
}

export function snapshotEndpoint(baseUrl: string): string {
  return endpointUrl(baseUrl, SNAPSHOT_PATH)
}

function endpointUrl(baseUrl: string, path: string): string {
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return new URL(path, normalized).toString()
}

export function formatSnapshotDiagnostics(diagnostics: SnapshotDiagnostics, sourceUrl?: string): string {
  const cacheRows: Array<[string, string]> = [
    ['URL', sourceUrl ?? diagnosticsEndpoint(DEFAULT_BASE_URL)],
    ['Cache', cacheSummary(diagnostics)],
    ['Age', cacheAgeSummary(diagnostics)],
  ]

  if (!diagnostics.snapshot) {
    return [
      'Local Suite snapshot diagnostics',
      formatPairs(cacheRows),
      '',
      'No cached snapshot. Warm it by opening /api/snapshot or refreshing the app.',
    ].join('\n')
  }

  const counts = diagnostics.snapshot.counts
  const summaryRows: Array<[string, string]> = [
    ...cacheRows,
    ['Generated', diagnostics.snapshot.generatedAt],
    ['Projects', `${counts.projects} total / ${counts.attentionProjects} attention / ${counts.dirtyRepos} dirty`],
    ['Listeners', String(counts.listeners)],
    ['Docker', `${counts.runningContainers} running / ${counts.publicDockerPorts} public ports`],
    ['Docker state', dockerStateSummary(diagnostics)],
    ['Warnings', String(counts.warnings)],
  ]

  return [
    'Local Suite snapshot diagnostics',
    formatPairs(summaryRows),
    '',
    'Timing',
    formatPairs(timingRows(diagnostics.snapshot.timing.totalMs, diagnostics.snapshot.timing.phases)),
  ].join('\n')
}

export async function fetchSnapshotDiagnostics(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<SnapshotDiagnostics> {
  const endpoint = diagnosticsEndpoint(baseUrl)
  let response: Response

  try {
    response = await fetchFn(endpoint, { headers: { accept: 'application/json' } })
  } catch {
    throw new Error(`Local Suite is not reachable at ${baseUrl}. Start it with pnpm dev.`)
  }

  if (response.status === 404) {
    throw new Error(`Snapshot diagnostics are unavailable at ${endpoint}. Run pnpm dev; this endpoint is dev-only.`)
  }

  if (!response.ok) {
    throw new Error(`Snapshot diagnostics failed (${response.status} ${response.statusText}).`)
  }

  const body = await response.json()
  if (!isSnapshotDiagnostics(body)) {
    throw new Error('Snapshot diagnostics returned an unexpected response shape.')
  }

  return body
}

export async function fetchWarmedSnapshotDiagnostics(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<SnapshotDiagnostics> {
  await fetchSnapshotDiagnostics(baseUrl, fetchFn)
  await warmSnapshotCache(baseUrl, fetchFn)
  return fetchSnapshotDiagnostics(baseUrl, fetchFn)
}

export async function fetchDockerRefreshedSnapshotDiagnostics(
  baseUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<SnapshotDiagnostics> {
  const endpoint = refreshDockerEndpoint(baseUrl)
  let response: Response

  try {
    response = await fetchFn(endpoint, { headers: { accept: 'application/json' }, method: 'POST' })
  } catch {
    throw new Error(`Local Suite is not reachable at ${baseUrl}. Start it with pnpm dev.`)
  }

  if (response.status === 404) {
    throw new Error(`Snapshot diagnostics refresh is unavailable at ${endpoint}. Run pnpm dev; this endpoint is dev-only.`)
  }

  if (!response.ok) {
    throw new Error(`Snapshot diagnostics refresh failed (${response.status} ${response.statusText}).`)
  }

  const body = await response.json()
  if (!isSnapshotDiagnostics(body)) {
    throw new Error('Snapshot diagnostics refresh returned an unexpected response shape.')
  }

  return body
}

export async function warmSnapshotCache(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const endpoint = snapshotEndpoint(baseUrl)
  let response: Response

  try {
    response = await fetchFn(endpoint, { headers: { accept: 'application/json' } })
  } catch {
    throw new Error(`Local Suite is not reachable at ${baseUrl}. Start it with pnpm dev.`)
  }

  if (response.status === 404) {
    throw new Error(`Snapshot endpoint is unavailable at ${endpoint}. Check the Local Suite server.`)
  }

  if (!response.ok) {
    throw new Error(`Snapshot warm failed (${response.status} ${response.statusText}).`)
  }

  await response.arrayBuffer()
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): CliOptions {
  let baseUrl = env.LOCAL_SUITE_URL ?? DEFAULT_BASE_URL
  let help = false
  let refreshDocker = false
  let warm = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--warm') {
      warm = true
      continue
    }
    if (arg === '--refresh-docker') {
      refreshDocker = true
      continue
    }
    if (arg === '--url') {
      const next = argv[index + 1]
      if (!next) throw new Error('Missing value for --url.')
      baseUrl = next
      index += 1
      continue
    }
    if (arg === '--help' || arg === '-h') {
      help = true
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }

  if (refreshDocker && warm) {
    throw new Error('Use either --warm or --refresh-docker, not both.')
  }

  return { baseUrl, help, refreshDocker, warm }
}

function cacheSummary(diagnostics: SnapshotDiagnostics): string {
  const cache = diagnostics.cache
  return `${cache.state}${cache.refreshInFlight ? ' / refresh in flight' : ''}`
}

function cacheAgeSummary(diagnostics: SnapshotDiagnostics): string {
  const cache = diagnostics.cache
  return `${formatDuration(cache.ageMs)} / fresh ${formatDuration(cache.freshForMs)} / max stale ${formatDuration(cache.maxStaleMs)}`
}

function dockerStateSummary(diagnostics: SnapshotDiagnostics): string {
  const dockerState = diagnostics.snapshot?.dockerState
  if (!dockerState) return '-'
  return `${dockerState.source} / age ${formatDuration(dockerState.ageMs)} / fresh ${formatDuration(dockerState.freshForMs)}`
}

function timingRows(totalMs: number, phases: Record<string, number>): Array<[string, string]> {
  const phaseRows = Object.entries(phases)
    .sort((left, right) => right[1] - left[1])
    .map(([phase, ms]): [string, string] => [phase, formatDuration(ms)])

  return [['total', formatDuration(totalMs)], ...phaseRows]
}

function formatPairs(rows: Array<[string, string]>): string {
  const width = Math.max(...rows.map(([label]) => label.length))
  return rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`).join('\n')
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '-'
  if (ms < 1_000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)}s`
  return `${Math.round(ms / 60_000)}m`
}

function isSnapshotDiagnostics(value: unknown): value is SnapshotDiagnostics {
  if (!isRecord(value) || !isRecord(value.cache)) return false
  if (typeof value.cache.state !== 'string') return false
  if (typeof value.cache.freshForMs !== 'number') return false
  if (typeof value.cache.maxStaleMs !== 'number') return false
  if (typeof value.cache.refreshInFlight !== 'boolean') return false
  if (value.snapshot === null) return true
  if (!isRecord(value.snapshot) || !isRecord(value.snapshot.counts) || !isRecord(value.snapshot.timing)) return false
  if (!isRecord(value.snapshot.dockerState)) return false

  return (
    typeof value.snapshot.generatedAt === 'string'
    && typeof value.snapshot.dockerState.ageMs === 'number'
    && typeof value.snapshot.dockerState.freshForMs === 'number'
    && typeof value.snapshot.dockerState.generatedAt === 'string'
    && (value.snapshot.dockerState.source === 'fresh' || value.snapshot.dockerState.source === 'cached')
    && typeof value.snapshot.timing.totalMs === 'number'
    && isRecord(value.snapshot.timing.phases)
    && Object.values(value.snapshot.timing.phases).every((duration) => typeof duration === 'number')
    && typeof value.snapshot.counts.projects === 'number'
    && typeof value.snapshot.counts.listeners === 'number'
    && typeof value.snapshot.counts.runningContainers === 'number'
    && typeof value.snapshot.counts.publicDockerPorts === 'number'
    && typeof value.snapshot.counts.attentionProjects === 'number'
    && typeof value.snapshot.counts.dirtyRepos === 'number'
    && typeof value.snapshot.counts.warnings === 'number'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function main() {
  const options = parseArgs(process.argv.slice(2), process.env)
  if (options.help) {
    console.log(USAGE)
    return
  }

  const endpoint = diagnosticsEndpoint(options.baseUrl)
  const diagnostics = options.refreshDocker
    ? await fetchDockerRefreshedSnapshotDiagnostics(options.baseUrl)
    : options.warm
      ? await fetchWarmedSnapshotDiagnostics(options.baseUrl)
      : await fetchSnapshotDiagnostics(options.baseUrl)
  console.log(formatSnapshotDiagnostics(diagnostics, endpoint))
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (entrypoint === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
