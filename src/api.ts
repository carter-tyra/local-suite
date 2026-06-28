import type { ActionResult, LocalSuiteSnapshot, SafeAction } from './shared/types.ts'

export async function fetchSnapshot(): Promise<LocalSuiteSnapshot> {
  const response = await fetch('/api/snapshot', { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Snapshot failed (${response.status})`)
  }
  return await response.json() as LocalSuiteSnapshot
}

export async function runAction(input: {
  actionId: SafeAction['id']
  projectId?: string
}): Promise<ActionResult> {
  const response = await fetch('/api/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null
    throw new Error(body?.message ?? `Action failed (${response.status})`)
  }
  return await response.json() as ActionResult
}
