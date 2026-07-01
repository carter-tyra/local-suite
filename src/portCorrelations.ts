import type { ListenerPort, ProjectSummary } from './shared/types.ts'
import { listenerRuleKey } from './shared/listenerRules.ts'

export type ProjectPortSource = 'docker' | 'listener' | 'both'

export interface ProjectPortItem {
  bindIp: string
  port: string
  scope: ListenerPort['scope']
  source: ProjectPortSource
  command: string | null
  projectMatch: ListenerPort['projectMatch']
}

export interface ProjectPortSummary {
  projectId: string
  ports: ProjectPortItem[]
}

export interface UnresolvedListenerReviewItem {
  bindIp: string
  command: string
  count: number
  key: string
  port: string
  scope: ListenerPort['scope']
}

export function summarizeProjectPorts(
  projects: ProjectSummary[],
  listeners: ListenerPort[],
): ProjectPortSummary[] {
  const summaries = new Map<string, Map<string, ProjectPortItem>>()

  for (const project of projects) {
    for (const dockerPort of project.docker?.ports ?? []) {
      if (!dockerPort.hostPort) continue
      const bindIp = dockerPort.hostIp || '*'
      upsertProjectPort(summaries, project.id, {
        bindIp,
        command: null,
        port: dockerPort.hostPort,
        projectMatch: 'docker-port',
        scope: dockerPort.public ? 'public' : 'local',
        source: 'docker',
      })
    }
  }

  for (const listener of listeners) {
    if (!listener.projectId) continue
    upsertProjectPort(summaries, listener.projectId, {
      bindIp: listener.bindIp,
      command: listener.command,
      port: listener.port,
      projectMatch: listener.projectMatch,
      scope: listener.scope,
      source: 'listener',
    })
  }

  return Array.from(summaries, ([projectId, ports]) => ({
    projectId,
    ports: Array.from(ports.values()).sort(sortProjectPortItems),
  })).sort((left, right) => {
    const leftProjectIndex = projects.findIndex((project) => project.id === left.projectId)
    const rightProjectIndex = projects.findIndex((project) => project.id === right.projectId)
    return leftProjectIndex - rightProjectIndex
  })
}

export function countResolvedListeners(listeners: ListenerPort[]): number {
  return listeners.filter((listener) => listener.projectId).length
}

export function summarizeUnresolvedListeners(listeners: ListenerPort[]): UnresolvedListenerReviewItem[] {
  const unresolved = new Map<string, UnresolvedListenerReviewItem>()

  for (const listener of listeners) {
    if (listener.owner !== 'external' || listener.projectId || listener.classification === 'ignored') continue

    const key = listener.ruleKey || listenerRuleKey(listener)
    const currentItem = unresolved.get(key)
    if (currentItem) {
      unresolved.set(key, { ...currentItem, count: currentItem.count + 1 })
      continue
    }

    unresolved.set(key, {
      bindIp: listener.bindIp,
      command: listener.command || 'unknown',
      count: 1,
      key,
      port: listener.port,
      scope: listener.scope,
    })
  }

  return Array.from(unresolved.values()).sort(sortUnresolvedListeners)
}

function upsertProjectPort(
  summaries: Map<string, Map<string, ProjectPortItem>>,
  projectId: string,
  nextItem: ProjectPortItem,
): void {
  const projectPorts = summaries.get(projectId) ?? new Map<string, ProjectPortItem>()
  summaries.set(projectId, projectPorts)

  const key = `${nextItem.bindIp}:${nextItem.port}`
  const currentItem = projectPorts.get(key)
  if (!currentItem) {
    projectPorts.set(key, nextItem)
    return
  }

  projectPorts.set(key, {
    ...currentItem,
    command: nextItem.command ?? currentItem.command,
    projectMatch: nextItem.projectMatch ?? currentItem.projectMatch,
    scope: currentItem.scope === 'public' || nextItem.scope === 'public' ? 'public' : currentItem.scope,
    source: currentItem.source === nextItem.source ? currentItem.source : 'both',
  })
}

function sortProjectPortItems(left: ProjectPortItem, right: ProjectPortItem): number {
  return numericPort(left.port) - numericPort(right.port) || left.bindIp.localeCompare(right.bindIp)
}

function numericPort(port: string): number {
  const parsed = Number(port)
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

function sortUnresolvedListeners(left: UnresolvedListenerReviewItem, right: UnresolvedListenerReviewItem): number {
  return (
    unresolvedRank(left.scope) - unresolvedRank(right.scope) ||
    numericPort(left.port) - numericPort(right.port) ||
    left.command.localeCompare(right.command)
  )
}

function unresolvedRank(scope: ListenerPort['scope']): number {
  if (scope === 'public') return 0
  if (scope === 'unknown') return 1
  return 2
}
