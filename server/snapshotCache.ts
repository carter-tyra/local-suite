import type { LocalSuiteSnapshot, SnapshotCacheInfo, SnapshotDiagnostics } from '../src/shared/types.ts'
import type { SuiteConfig } from './config.ts'
import { buildSnapshot } from './discovery.ts'

export const SNAPSHOT_CACHE_FRESH_MS = 10_000
export const SNAPSHOT_CACHE_MAX_STALE_MS = 120_000

interface SnapshotCacheEntry {
  completedAtMs: number
  snapshot: LocalSuiteSnapshot
}

interface SnapshotCacheOptions {
  build?: (config: SuiteConfig) => Promise<LocalSuiteSnapshot>
  freshMs?: number
  maxStaleMs?: number
  now?: () => number
}

export interface SnapshotCache {
  getDiagnostics: () => SnapshotDiagnostics
  getSnapshot: (config: SuiteConfig) => Promise<LocalSuiteSnapshot>
  invalidate: () => void
}

export function createSnapshotCache(options: SnapshotCacheOptions = {}): SnapshotCache {
  const build = options.build ?? buildSnapshot
  const freshMs = options.freshMs ?? SNAPSHOT_CACHE_FRESH_MS
  const maxStaleMs = options.maxStaleMs ?? SNAPSHOT_CACHE_MAX_STALE_MS
  const now = options.now ?? Date.now
  let cache: SnapshotCacheEntry | null = null
  let refresh: Promise<SnapshotCacheEntry> | null = null
  let generation = 0
  let lastRefreshFailedAtMs: number | null = null

  const startRefresh = (config: SuiteConfig): Promise<SnapshotCacheEntry> => {
    if (refresh) return refresh
    const refreshGeneration = generation
    refresh = build(config)
      .then((snapshot) => {
        const entry = { completedAtMs: now(), snapshot }
        if (refreshGeneration === generation) {
          cache = entry
          lastRefreshFailedAtMs = null
        }
        return entry
      })
      .catch((error: unknown) => {
        lastRefreshFailedAtMs = now()
        throw error
      })
      .finally(() => {
        refresh = null
      })
    return refresh
  }

  const withCacheInfo = (entry: SnapshotCacheEntry, state: SnapshotCacheInfo['state']): LocalSuiteSnapshot => {
    const ageMs = Math.max(0, Math.round(now() - entry.completedAtMs))
    const warning = lastRefreshFailedAtMs ? 'Snapshot refresh failed; serving cached state.' : null

    return {
      ...entry.snapshot,
      cache: {
        ageMs,
        freshForMs: freshMs,
        generatedAt: new Date(entry.completedAtMs).toISOString(),
        maxStaleMs,
        state,
      },
      warnings: warning ? [...entry.snapshot.warnings, warning] : entry.snapshot.warnings,
    }
  }

  const diagnosticsState = (entry: SnapshotCacheEntry): SnapshotDiagnostics['cache']['state'] => {
    const ageMs = now() - entry.completedAtMs
    if (refresh) return 'refreshing'
    if (ageMs <= freshMs) return 'fresh'
    if (ageMs > maxStaleMs) return 'expired'
    return 'stale'
  }

  return {
    getDiagnostics(): SnapshotDiagnostics {
      if (!cache) {
        return {
          cache: {
            ageMs: null,
            freshForMs: freshMs,
            generatedAt: null,
            hasSnapshot: false,
            lastRefreshFailedAt: lastRefreshFailedAtMs ? new Date(lastRefreshFailedAtMs).toISOString() : null,
            maxStaleMs,
            refreshInFlight: Boolean(refresh),
            state: 'empty',
          },
          snapshot: null,
        }
      }

      return {
        cache: {
          ageMs: Math.max(0, Math.round(now() - cache.completedAtMs)),
          freshForMs: freshMs,
          generatedAt: new Date(cache.completedAtMs).toISOString(),
          hasSnapshot: true,
          lastRefreshFailedAt: lastRefreshFailedAtMs ? new Date(lastRefreshFailedAtMs).toISOString() : null,
          maxStaleMs,
          refreshInFlight: Boolean(refresh),
          state: diagnosticsState(cache),
        },
        snapshot: {
          counts: {
            attentionProjects: cache.snapshot.summary.attentionProjects,
            dirtyRepos: cache.snapshot.summary.dirtyRepos,
            listeners: cache.snapshot.listeners.length,
            projects: cache.snapshot.projects.length,
            publicDockerPorts: cache.snapshot.docker.publicPortCount,
            runningContainers: cache.snapshot.docker.runningContainers,
            warnings: cache.snapshot.warnings.length,
          },
          dockerState: cache.snapshot.dockerState,
          generatedAt: cache.snapshot.generatedAt,
          timing: cache.snapshot.timing,
        },
      }
    },

    async getSnapshot(config: SuiteConfig): Promise<LocalSuiteSnapshot> {
      if (!cache) {
        const entry = await startRefresh(config)
        return withCacheInfo(entry, 'miss')
      }

      const ageMs = now() - cache.completedAtMs
      if (ageMs <= freshMs) {
        return withCacheInfo(cache, 'fresh')
      }

      if (ageMs > maxStaleMs && !refresh) {
        try {
          const entry = await startRefresh(config)
          return withCacheInfo(entry, 'expired')
        } catch {
          if (cache) return withCacheInfo(cache, 'stale')
          throw new Error('Snapshot refresh failed.')
        }
      }

      void startRefresh(config).catch(() => undefined)
      return withCacheInfo(cache, 'refreshing')
    },

    invalidate() {
      generation += 1
      cache = null
      refresh = null
      lastRefreshFailedAtMs = null
    },
  }
}

export const snapshotCache = createSnapshotCache()
