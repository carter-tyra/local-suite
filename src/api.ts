import type {
  ActionRequest,
  ActionResult,
  ListenerRuleMutationResult,
  ListenerRulePreview,
  LocalSuiteSnapshot,
} from './shared/types.ts'
import type { ListenerRuleIdentity } from './shared/listenerRules.ts'

export async function fetchSnapshot(): Promise<LocalSuiteSnapshot> {
  const response = await fetch('/api/snapshot', { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Snapshot failed (${response.status})`)
  }
  return await response.json() as LocalSuiteSnapshot
}

export async function runAction(input: ActionRequest): Promise<ActionResult> {
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

export async function previewIgnoredListenerRule(input: ListenerRuleIdentity & { key: string }): Promise<ListenerRulePreview> {
  return await postListenerRule('/api/listener-rules/preview-ignore', input) as ListenerRulePreview
}

export async function ignoreListenerRule(input: ListenerRuleIdentity & { key: string }): Promise<ListenerRuleMutationResult> {
  return await postListenerRule('/api/listener-rules/ignore', input) as ListenerRuleMutationResult
}

async function postListenerRule(
  url: string,
  input: ListenerRuleIdentity & { key: string },
): Promise<ListenerRulePreview | ListenerRuleMutationResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null
    throw new Error(body?.message ?? `Listener rule failed (${response.status})`)
  }
  return await response.json() as ListenerRulePreview | ListenerRuleMutationResult
}
