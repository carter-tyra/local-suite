import type { ListenerPort } from './shared/types.ts'

export type ListenerFilter = 'external-public' | 'local-suite' | 'local-only' | 'ignored'

export interface ListenerFilterOption {
  value: ListenerFilter
  label: string
}

export const LISTENER_FILTERS = [
  { value: 'external-public', label: 'External public' },
  { value: 'local-suite', label: 'Local Suite' },
  { value: 'local-only', label: 'Local only' },
  { value: 'ignored', label: 'Ignored' },
] as const satisfies readonly ListenerFilterOption[]

const LISTENER_FILTER_VALUES = new Set<ListenerFilter>(LISTENER_FILTERS.map((filter) => filter.value))

export function toListenerFilter(value: string): ListenerFilter {
  return LISTENER_FILTER_VALUES.has(value as ListenerFilter) ? (value as ListenerFilter) : 'external-public'
}

export function countListenersByFilter(listeners: ListenerPort[]): Record<ListenerFilter, number> {
  return Object.fromEntries(
    LISTENER_FILTERS.map((filter) => [filter.value, filterListeners(listeners, filter.value).length]),
  ) as Record<ListenerFilter, number>
}

export function filterListeners(listeners: ListenerPort[], filter: ListenerFilter): ListenerPort[] {
  return listeners.filter((listener) => {
    if (filter === 'ignored') return listener.classification === 'ignored'
    if (listener.classification === 'ignored') return false
    if (filter === 'external-public') return listener.owner === 'external' && listener.scope === 'public'
    if (filter === 'local-suite') return listener.owner === 'local-suite'
    return listener.owner === 'external' && listener.scope === 'local'
  })
}

export function sortListenersForDisplay(listeners: ListenerPort[]): ListenerPort[] {
  return [...listeners].sort((left, right) => {
    return (
      listenerRank(left) - listenerRank(right) ||
      numericPort(left.port) - numericPort(right.port) ||
      left.command.localeCompare(right.command)
    )
  })
}

export function listenerSourceLabel(listener: ListenerPort): string {
  return listener.owner === 'local-suite' ? 'Local Suite' : 'External'
}

function listenerRank(listener: ListenerPort): number {
  if (listener.owner === 'local-suite') return 0
  if (listener.scope === 'public') return 1
  if (listener.scope === 'unknown') return 2
  return 3
}

function numericPort(port: string): number {
  const parsed = Number(port)
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}
