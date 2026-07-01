import type { SnapshotDiagnostics } from './shared/types.ts'

export async function refreshDockerDiagnostics(): Promise<SnapshotDiagnostics> {
  const response = await fetch('/api/dev/snapshot-diagnostics/refresh-docker', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null
    throw new Error(body?.message ?? `Docker refresh failed (${response.status})`)
  }
  return await response.json() as SnapshotDiagnostics
}
