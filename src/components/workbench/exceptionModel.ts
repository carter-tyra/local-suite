import { filterListeners, listenerSourceLabel } from '../../listenerFilters.ts'
import {
  summarizeUnresolvedListeners,
  type UnresolvedListenerReviewItem,
} from '../../portCorrelations.ts'
import { formatDuration, formatMib, plural } from '../../format.ts'
import type { ListenerPort, LocalSuiteSnapshot, ProjectSummary } from '../../shared/types.ts'
import type { ProjectEvent, WorkbenchDialog } from './types.ts'

export type WorkbenchExceptionKind =
  | 'public-listeners'
  | 'unresolved-listeners'
  | 'dirty-repos'
  | 'stopped-active'
  | 'unregistered-docker'
  | 'docker-memory'
  | 'snapshot-stale'
  | 'warnings'
  | 'all-clear'

export type WorkbenchExceptionSeverity = 'high' | 'medium' | 'low' | 'clear'

export interface WorkbenchEvidenceItem {
  detail: string
  label: string
  projectId?: string
  tone: ProjectEvent['tone']
  value: string
}

export interface WorkbenchException {
  actionLabel: string
  count: number
  detail: string
  dialog: WorkbenchDialog
  evidence: WorkbenchEvidenceItem[]
  id: string
  kind: WorkbenchExceptionKind
  primaryProjectId: string | null
  projectIds: string[]
  severity: WorkbenchExceptionSeverity
  title: string
  tone: ProjectEvent['tone']
}

const DOCKER_MEMORY_WARNING_RATIO = 0.7
const MAX_EVIDENCE_ITEMS = 6

export function buildWorkbenchExceptions(snapshot: LocalSuiteSnapshot): WorkbenchException[] {
  const projectById = new Map(snapshot.projects.map((project) => [project.id, project]))
  const exceptions = [
    publicListenerException(snapshot, projectById),
    unresolvedListenerException(snapshot),
    dirtyRepoException(snapshot.projects),
    stoppedActiveException(snapshot.projects),
    unregisteredDockerException(snapshot.projects),
    dockerMemoryException(snapshot),
    staleSnapshotException(snapshot),
    warningsException(snapshot),
  ].filter((exception): exception is WorkbenchException => exception !== null)

  if (!exceptions.length) return [allClearException(snapshot)]
  return exceptions.sort(sortExceptions)
}

export function exceptionCountLabel(exceptions: WorkbenchException[]): string {
  const actionable = exceptions.filter((exception) => exception.kind !== 'all-clear')
  return String(actionable.length)
}

export function selectedExceptionFrom(
  exceptions: WorkbenchException[],
  selectedExceptionId: string | null,
): WorkbenchException {
  return exceptions.find((exception) => exception.id === selectedExceptionId) ?? exceptions[0]!
}

export function severityLabel(severity: WorkbenchExceptionSeverity): string {
  if (severity === 'high') return 'High'
  if (severity === 'medium') return 'Medium'
  if (severity === 'low') return 'Low'
  return 'Clear'
}

export function severityTone(severity: WorkbenchExceptionSeverity): ProjectEvent['tone'] {
  if (severity === 'high') return 'error'
  if (severity === 'medium') return 'warning'
  if (severity === 'low') return 'success'
  return 'success'
}

export function projectExceptionSummary(project: ProjectSummary, snapshot: LocalSuiteSnapshot): string {
  const publicPorts = filterListeners(snapshot.listeners, 'external-public')
    .filter((listener) => listener.projectId === project.id)
    .length
  const dirty = project.git.dirtyCount
  const running = project.runtime.ownedProcesses.length
  const docker = project.docker?.running ?? 0

  if (publicPorts) return plural(publicPorts, 'public listener')
  if (dirty) return `${dirty} changed`
  if (running) return plural(running, 'process')
  if (docker) return plural(docker, 'container')
  return project.status
}

export function projectExceptionTone(project: ProjectSummary, snapshot: LocalSuiteSnapshot): ProjectEvent['tone'] {
  if (filterListeners(snapshot.listeners, 'external-public').some((listener) => listener.projectId === project.id)) return 'error'
  if (project.git.dirtyCount || project.status === 'attention') return 'warning'
  if (project.runtime.status === 'running' || project.docker?.running) return 'success'
  return 'neutral'
}

function publicListenerException(
  snapshot: LocalSuiteSnapshot,
  projectById: Map<string, ProjectSummary>,
): WorkbenchException | null {
  const listeners = filterListeners(snapshot.listeners, 'external-public')
  if (!listeners.length) return null
  const projectIds = uniqueProjectIds(listeners)

  return {
    actionLabel: 'Review ports',
    count: listeners.length,
    detail: `${plural(listeners.length, 'listener')} exposed beyond Local Suite`,
    dialog: 'ports',
    evidence: listeners.slice(0, MAX_EVIDENCE_ITEMS).map((listener) => ({
      detail: projectNameForListener(listener, projectById),
      label: `${listener.bindIp}:${listener.port}`,
      projectId: listener.projectId ?? undefined,
      tone: 'error',
      value: listener.command || listenerSourceLabel(listener),
    })),
    id: 'public-listeners',
    kind: 'public-listeners',
    primaryProjectId: projectIds[0] ?? null,
    projectIds,
    severity: 'high',
    title: 'Public listeners',
    tone: 'error',
  }
}

function unresolvedListenerException(snapshot: LocalSuiteSnapshot): WorkbenchException | null {
  const unresolved = summarizeUnresolvedListeners(snapshot.listeners)
  const total = unresolved.reduce((sum, item) => sum + item.count, 0)
  if (!total) return null

  return {
    actionLabel: 'Review listeners',
    count: total,
    detail: `${plural(total, 'listener')} without a project match`,
    dialog: 'listeners',
    evidence: unresolved.slice(0, MAX_EVIDENCE_ITEMS).map((item) => unresolvedEvidence(item)),
    id: 'unresolved-listeners',
    kind: 'unresolved-listeners',
    primaryProjectId: null,
    projectIds: [],
    severity: 'high',
    title: 'Unresolved listeners',
    tone: 'error',
  }
}

function dirtyRepoException(projects: ProjectSummary[]): WorkbenchException | null {
  const dirtyProjects = projects
    .filter((project) => project.git.dirtyCount > 0)
    .sort((left, right) => right.git.dirtyCount - left.git.dirtyCount || left.displayName.localeCompare(right.displayName))
  if (!dirtyProjects.length) return null
  const changedFiles = dirtyProjects.reduce((sum, project) => sum + project.git.dirtyCount, 0)

  return {
    actionLabel: 'Open Git',
    count: dirtyProjects.length,
    detail: `${plural(dirtyProjects.length, 'repo')} / ${plural(changedFiles, 'changed file')}`,
    dialog: 'git',
    evidence: dirtyProjects.slice(0, MAX_EVIDENCE_ITEMS).map((project) => ({
      detail: project.git.branch ?? project.git.status,
      label: project.displayName,
      projectId: project.id,
      tone: 'warning',
      value: `${project.git.dirtyCount} changed`,
    })),
    id: 'dirty-repos',
    kind: 'dirty-repos',
    primaryProjectId: dirtyProjects[0]?.id ?? null,
    projectIds: dirtyProjects.map((project) => project.id),
    severity: dirtyProjects.length > 8 || changedFiles > 80 ? 'high' : 'medium',
    title: 'Dirty repos',
    tone: dirtyProjects.length > 8 || changedFiles > 80 ? 'error' : 'warning',
  }
}

function stoppedActiveException(projects: ProjectSummary[]): WorkbenchException | null {
  const stopped = projects
    .filter((project) => project.priority === 'active' && project.runtime.status === 'stopped' && project.runtime.primaryTarget)
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === 'attention' ? -1 : 1
      return left.displayName.localeCompare(right.displayName)
    })
  if (!stopped.length) return null

  return {
    actionLabel: 'Pick project',
    count: stopped.length,
    detail: `${plural(stopped.length, 'active project')} stopped`,
    dialog: null,
    evidence: stopped.slice(0, MAX_EVIDENCE_ITEMS).map((project) => ({
      detail: project.runtime.primaryTarget?.commandLabel ?? 'No run target',
      label: project.displayName,
      projectId: project.id,
      tone: project.status === 'attention' ? 'warning' : 'neutral',
      value: project.status,
    })),
    id: 'stopped-active',
    kind: 'stopped-active',
    primaryProjectId: stopped[0]?.id ?? null,
    projectIds: stopped.map((project) => project.id),
    severity: 'medium',
    title: 'Stopped active projects',
    tone: 'warning',
  }
}

function unregisteredDockerException(projects: ProjectSummary[]): WorkbenchException | null {
  const unregistered = projects
    .filter((project) => project.docker && project.docker.running > 0 && !project.docker.registered)
    .sort((left, right) => (right.docker?.running ?? 0) - (left.docker?.running ?? 0))
  if (!unregistered.length) return null

  return {
    actionLabel: 'Open Docker',
    count: unregistered.length,
    detail: `${plural(unregistered.length, 'project')} has unregistered containers`,
    dialog: 'docker',
    evidence: unregistered.slice(0, MAX_EVIDENCE_ITEMS).map((project) => ({
      detail: project.docker?.composeProject ?? 'unregistered',
      label: project.displayName,
      projectId: project.id,
      tone: 'warning',
      value: plural(project.docker?.running ?? 0, 'container'),
    })),
    id: 'unregistered-docker',
    kind: 'unregistered-docker',
    primaryProjectId: unregistered[0]?.id ?? null,
    projectIds: unregistered.map((project) => project.id),
    severity: 'medium',
    title: 'Unregistered Docker',
    tone: 'warning',
  }
}

function dockerMemoryException(snapshot: LocalSuiteSnapshot): WorkbenchException | null {
  const limit = snapshot.docker.memoryLimitMib
  if (!limit) return null
  const ratio = snapshot.docker.memMib / limit
  if (ratio < DOCKER_MEMORY_WARNING_RATIO) return null

  return {
    actionLabel: 'Open Docker',
    count: 1,
    detail: `${formatMib(snapshot.docker.memMib)} of ${formatMib(limit)}`,
    dialog: 'docker',
    evidence: [
      {
        detail: `${snapshot.docker.runningContainers}/${snapshot.docker.totalContainers} containers`,
        label: 'Docker memory',
        tone: ratio > 0.85 ? 'error' : 'warning',
        value: `${Math.round(ratio * 100)}%`,
      },
    ],
    id: 'docker-memory',
    kind: 'docker-memory',
    primaryProjectId: null,
    projectIds: [],
    severity: ratio > 0.85 ? 'high' : 'medium',
    title: 'Docker memory high',
    tone: ratio > 0.85 ? 'error' : 'warning',
  }
}

function staleSnapshotException(snapshot: LocalSuiteSnapshot): WorkbenchException | null {
  if (!snapshot.cache || (snapshot.cache.state !== 'stale' && snapshot.cache.state !== 'expired')) return null

  return {
    actionLabel: 'Refresh',
    count: 1,
    detail: `Snapshot is ${formatDuration(snapshot.cache.ageMs)} old`,
    dialog: null,
    evidence: [
      {
        detail: `Fresh for ${formatDuration(snapshot.cache.freshForMs)}`,
        label: 'Snapshot cache',
        tone: 'warning',
        value: snapshot.cache.state,
      },
    ],
    id: 'snapshot-stale',
    kind: 'snapshot-stale',
    primaryProjectId: null,
    projectIds: [],
    severity: 'medium',
    title: 'Stale snapshot',
    tone: 'warning',
  }
}

function warningsException(snapshot: LocalSuiteSnapshot): WorkbenchException | null {
  if (!snapshot.warnings.length) return null

  return {
    actionLabel: 'Review',
    count: snapshot.warnings.length,
    detail: `${plural(snapshot.warnings.length, 'snapshot warning')}`,
    dialog: null,
    evidence: snapshot.warnings.slice(0, MAX_EVIDENCE_ITEMS).map((warning) => ({
      detail: 'Snapshot warning',
      label: warning,
      tone: 'warning',
      value: 'warning',
    })),
    id: 'warnings',
    kind: 'warnings',
    primaryProjectId: null,
    projectIds: [],
    severity: 'medium',
    title: 'Snapshot warnings',
    tone: 'warning',
  }
}

function allClearException(snapshot: LocalSuiteSnapshot): WorkbenchException {
  return {
    actionLabel: 'Refresh',
    count: 0,
    detail: `Fresh ${formatDuration(snapshot.dockerState.ageMs)} ago`,
    dialog: null,
    evidence: [
      {
        detail: snapshot.docker.publicPortsMessage,
        label: 'Public Docker ports',
        tone: 'success',
        value: String(snapshot.docker.publicPortCount),
      },
      {
        detail: `${snapshot.docker.runningContainers}/${snapshot.docker.totalContainers} containers`,
        label: 'Docker',
        tone: 'success',
        value: formatMib(snapshot.docker.memMib),
      },
    ],
    id: 'all-clear',
    kind: 'all-clear',
    primaryProjectId: null,
    projectIds: [],
    severity: 'clear',
    title: 'No urgent exceptions',
    tone: 'success',
  }
}

function unresolvedEvidence(item: UnresolvedListenerReviewItem): WorkbenchEvidenceItem {
  return {
    detail: item.command,
    label: `${item.bindIp}:${item.port}`,
    tone: item.scope === 'public' ? 'error' : 'warning',
    value: item.count > 1 ? `${item.count} matches` : item.scope,
  }
}

function projectNameForListener(listener: ListenerPort, projectById: Map<string, ProjectSummary>): string {
  if (!listener.projectId) return 'Unmatched'
  return projectById.get(listener.projectId)?.displayName ?? listener.projectId
}

function uniqueProjectIds(listeners: ListenerPort[]): string[] {
  return Array.from(new Set(listeners.map((listener) => listener.projectId).filter((id): id is string => Boolean(id))))
}

function sortExceptions(left: WorkbenchException, right: WorkbenchException): number {
  return (
    severityRank(left.severity) - severityRank(right.severity) ||
    right.count - left.count ||
    left.title.localeCompare(right.title)
  )
}

function severityRank(severity: WorkbenchExceptionSeverity): number {
  if (severity === 'high') return 0
  if (severity === 'medium') return 1
  if (severity === 'low') return 2
  return 3
}
