import type { BadgeVariant } from '@astryxdesign/core/Badge'
import type { SelectorOptionType } from '@astryxdesign/core/Selector'
import type { StatusDotVariant } from '@astryxdesign/core/StatusDot'
import { formatMib, formatTime, plural } from '../../format.ts'
import { listenerSourceLabel } from '../../listenerFilters.ts'
import { summarizeProjectPorts, summarizeUnresolvedListeners, type ProjectPortSummary } from '../../portCorrelations.ts'
import type {
  ActionRequest,
  ActionResult,
  ListenerPort,
  LocalSuiteSnapshot,
  ProjectRuntimeHistoryEntry,
  ProjectRuntimeProcess,
  ProjectSummary,
  RunTarget,
  SafeAction,
} from '../../shared/types.ts'
import type { DetailTab, ProjectEvent, RuntimeActionState, WorkbenchDialog } from './types.ts'

export function runTargetForProject(project: ProjectSummary, selectedRunTargetId: string): RunTarget | null {
  return project.runtime.targets.find((target) => target.id === selectedRunTargetId) ?? project.runtime.primaryTarget
}

export function runTargetSelectorOptions(targets: RunTarget[]): SelectorOptionType[] {
  const toOption = (target: RunTarget) => ({
    label: target.commandLabel,
    value: target.id,
  })

  if (targets.length <= 8) return targets.map(toOption)

  const preferred = targets.filter((target) => target.primary).map(toOption)
  const scripts = targets.filter((target) => !target.primary).map(toOption)
  const sections: SelectorOptionType[] = []
  if (preferred.length) sections.push({ options: preferred, title: 'Preferred', type: 'section' })
  if (scripts.length) sections.push({ options: scripts, title: 'Scripts', type: 'section' })
  return sections
}

export function toDetailTab(value: string): DetailTab {
  if (value === 'ports' || value === 'history' || value === 'git' || value === 'config') return value
  return 'run'
}

export function actionLabel(action: SafeAction, selectedRunTarget: RunTarget | null): string {
  if (action.id === 'script-start' && selectedRunTarget) return selectedRunTarget.label
  return action.label
}

export function actionReason(action: SafeAction, selectedRunTarget: RunTarget | null): string {
  if (action.id === 'script-start' && selectedRunTarget) return `Open Ghostty / ${selectedRunTarget.commandLabel}`
  return action.reason
}

export function runtimeActionState(input: {
  actionError: string | null
  actionResult: ActionResult | null
  lastRequest: ActionRequest | null
  pendingRequest: ActionRequest | null
  project: ProjectSummary
  selectedRunTarget: RunTarget | null
}): RuntimeActionState {
  const { actionError, actionResult, lastRequest, pendingRequest, project, selectedRunTarget } = input
  const latestEntry = project.runtime.history[0] ?? null
  const currentActionResult = actionResult?.projectId === project.id ? actionResult : null

  if (pendingRequest?.projectId === project.id) {
    return {
      actionId: pendingRequest.actionId,
      detail: pendingActionDetail(project, selectedRunTarget, pendingRequest),
      phase: 'pending',
      projectId: project.id,
      title: pendingActionTitle(pendingRequest.actionId),
      tone: 'warning',
    }
  }

  if (actionError && lastRequest?.projectId === project.id) {
    return {
      actionId: lastRequest.actionId,
      detail: actionError,
      phase: 'failed',
      projectId: project.id,
      title: failedActionTitle(lastRequest.actionId),
      tone: 'error',
    }
  }

  if (currentActionResult && isActionResultCurrent(currentActionResult, latestEntry)) {
    return actionResultState(project.id, currentActionResult)
  }

  if (latestEntry?.status === 'stale') {
    return {
      actionId: 'script-start',
      detail: `${latestEntry.commandLabel} lost its process`,
      phase: 'stale',
      projectId: project.id,
      title: 'Stale process',
      tone: 'warning',
    }
  }

  if (latestEntry?.stopResult === 'failed') {
    return {
      actionId: 'script-stop',
      detail: latestEntry.commandLabel,
      phase: 'failed',
      projectId: project.id,
      title: 'Stop failed',
      tone: 'error',
    }
  }

  if (latestEntry?.stopRequestedAt && (latestEntry.status === 'running' || latestEntry.status === 'starting')) {
    return {
      actionId: 'script-stop',
      detail: latestEntry.commandLabel,
      phase: 'pending',
      projectId: project.id,
      title: 'Stop sent',
      tone: 'warning',
    }
  }

  if (latestEntry?.status === 'starting') {
    return {
      actionId: 'script-start',
      detail: latestEntry.commandLabel,
      phase: 'pending',
      projectId: project.id,
      title: 'Starting',
      tone: 'warning',
    }
  }

  if (project.runtime.status === 'running') {
    return {
      actionId: null,
      detail: project.runtime.stopReason,
      phase: 'success',
      projectId: project.id,
      title: 'Running',
      tone: 'success',
    }
  }

  return {
    actionId: null,
    detail: project.runtime.primaryTarget?.commandLabel ?? 'No run target',
    phase: 'idle',
    projectId: project.id,
    title: 'Stopped',
    tone: 'neutral',
  }
}

function actionResultState(projectId: string, result: ActionResult): RuntimeActionState {
  const failed = result.exitCode !== 0
  return {
    actionId: result.actionId,
    detail: actionResultDetail(result),
    phase: failed ? 'failed' : 'success',
    projectId,
    title: failed ? failedActionTitle(result.actionId) : successActionTitle(result.actionId),
    tone: failed ? 'error' : 'success',
  }
}

function isActionResultCurrent(result: ActionResult, latestEntry: ProjectRuntimeHistoryEntry | null): boolean {
  if (!latestEntry) return true
  return timestampFor(result.generatedAt) >= timestampFor(latestEntry.updatedAt)
}

function timestampFor(value: string): number {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function runtimeActionBadgeVariant(state: Pick<RuntimeActionState, 'phase'>): BadgeVariant {
  if (state.phase === 'failed') return 'error'
  if (state.phase === 'stale' || state.phase === 'pending') return 'warning'
  if (state.phase === 'success') return 'success'
  return 'neutral'
}

function pendingActionTitle(actionId: SafeAction['id']): string {
  if (actionId === 'script-start') return 'Starting'
  if (actionId === 'script-stop') return 'Stopping'
  return 'Running'
}

function pendingActionDetail(project: ProjectSummary, selectedRunTarget: RunTarget | null, request: ActionRequest): string {
  if (request.actionId === 'script-start') {
    const requestTarget = request.targetId ? runTargetForProject(project, request.targetId) : selectedRunTarget
    return requestTarget?.commandLabel ?? selectedRunTarget?.commandLabel ?? 'Opening Ghostty'
  }
  if (request.actionId === 'script-stop') return project.runtime.stopReason
  return request.actionId
}

function successActionTitle(actionId: SafeAction['id']): string {
  if (actionId === 'script-start') return 'Started'
  if (actionId === 'script-stop') return 'Stop sent'
  return 'Complete'
}

function failedActionTitle(actionId: SafeAction['id']): string {
  if (actionId === 'script-start') return 'Start failed'
  if (actionId === 'script-stop') return 'Stop failed'
  return 'Action failed'
}

function actionResultDetail(result: ActionResult): string {
  const output = result.exitCode === 0 ? result.stdout : result.stderr || result.stdout
  return output.trim() || `exit ${result.exitCode}`
}

export function projectEvents(project: ProjectSummary, snapshot: LocalSuiteSnapshot): ProjectEvent[] {
  const historyEvents = project.runtime.history.map((entry) => ({
    detail: runtimeHistoryResult(entry),
    meta: formatTime(entry.updatedAt),
    tone: entry.status === 'failed' || entry.status === 'stale' ? 'warning' : entry.status === 'running' ? 'success' : 'neutral',
    title: entry.stopRequestedAt ? 'stop sent' : entry.status === 'running' ? 'script started' : `script ${entry.status}`,
  } satisfies ProjectEvent))
  const processEvents = project.runtime.ownedProcesses.map((process: ProjectRuntimeProcess) => ({
    detail: process.port ? `${process.port} / ${process.command}` : process.command,
    meta: `pid ${process.pid}`,
    tone: process.scope === 'public' ? 'warning' : 'success',
    title: process.port ? 'port bound' : 'process tracked',
  } satisfies ProjectEvent))
  const listenerEvents = snapshot.listeners
    .filter((listener) => listener.projectId === project.id)
    .slice(0, 3)
    .map((listener) => ({
      detail: `${listener.bindIp}:${listener.port}`,
      meta: listenerSourceLabel(listener),
      tone: listener.scope === 'public' ? 'warning' : 'success',
      title: 'listener matched',
    } satisfies ProjectEvent))

  return [...processEvents, ...historyEvents, ...listenerEvents]
}

export function isTargetRunning(project: ProjectSummary, target: RunTarget): boolean {
  return project.runtime.ownedProcesses.some((process) => process.targetId === target.id)
}

export function projectPrimaryCommand(project: ProjectSummary): string {
  return project.runtime.primaryTarget?.commandLabel ?? project.package?.scripts[0] ?? 'no script'
}

export function projectPortSummary(project: ProjectSummary, listeners: ListenerPort[]): { hasPublic: boolean; primary: string; scope: string } {
  const ports = projectPortItems(project, listeners)
  const hasPublic = ports.some((port) => port.scope === 'public')
  return {
    hasPublic,
    primary: ports[0]?.port ?? '-',
    scope: hasPublic ? 'public' : ports.length ? 'local' : 'none',
  }
}

export function projectPortItems(project: ProjectSummary, listeners: ListenerPort[]) {
  return summarizeProjectPorts([project], listeners).find((summary) => summary.projectId === project.id)?.ports ?? []
}

export function statusBadgeVariant(status: ProjectSummary['status']): BadgeVariant {
  if (status === 'ready') return 'success'
  if (status === 'attention') return 'warning'
  if (status === 'idle') return 'neutral'
  return 'neutral'
}

export function statusDotVariant(status: ProjectSummary['status']): StatusDotVariant {
  if (status === 'ready') return 'success'
  if (status === 'attention') return 'warning'
  if (status === 'idle') return 'neutral'
  return 'neutral'
}

export function eventDotVariant(tone: ProjectEvent['tone']): StatusDotVariant {
  if (tone === 'success') return 'success'
  if (tone === 'warning') return 'warning'
  if (tone === 'error') return 'error'
  return 'neutral'
}

export function statusScopeVariant(scope: ListenerPort['scope']): StatusDotVariant {
  if (scope === 'local') return 'success'
  if (scope === 'public') return 'warning'
  return 'neutral'
}

export function runtimeHistoryDotVariant(status: ProjectRuntimeHistoryEntry['status']): StatusDotVariant {
  if (status === 'running') return 'success'
  if (status === 'failed' || status === 'stale') return 'warning'
  return 'neutral'
}

export function runtimeHistoryBadgeVariant(status: ProjectRuntimeHistoryEntry['status']): BadgeVariant {
  if (status === 'failed') return 'error'
  if (status === 'stale') return 'warning'
  if (status === 'starting') return 'info'
  if (status === 'running') return 'blue'
  return 'neutral'
}

export function runtimeHistoryStopBadge(entry: ProjectRuntimeHistoryEntry): { label: string; variant: BadgeVariant } | null {
  if (!entry.stopRequestedAt) return null
  if (entry.stopResult === 'failed') return { label: 'stop failed', variant: 'error' }
  return { label: 'stop sent', variant: 'info' }
}

export function runtimeHistoryDetail(entry: ProjectRuntimeHistoryEntry): string {
  return `Started ${formatTime(entry.startedAt)} / ${runtimeHistoryResult(entry)}`
}

export function runtimeHistoryResult(entry: ProjectRuntimeHistoryEntry): string {
  const stopResult = runtimeHistoryStopResult(entry)
  if (stopResult) return stopResult
  if (entry.status === 'running' || entry.status === 'starting') return entry.status
  if (entry.signal) return `signal ${entry.signal}`
  if (entry.exitCode !== null) return `exit ${entry.exitCode}`
  if (entry.exitedAt) return `ended ${formatTime(entry.exitedAt)}`
  return entry.status
}

export function runtimeHistoryStopResult(entry: ProjectRuntimeHistoryEntry): string | null {
  if (!entry.stopRequestedAt) return null
  if (entry.stopResult === 'failed') return `stop failed ${formatTime(entry.stopRequestedAt)}`
  if (entry.status === 'running' || entry.status === 'starting') return `stop sent ${formatTime(entry.stopRequestedAt)}`
  if (entry.signal) return `stopped ${entry.signal}`
  return `stop sent ${formatTime(entry.stopRequestedAt)}`
}

export function runtimeHistoryPidLabel(entry: ProjectRuntimeHistoryEntry): string {
  const pid = entry.childPid ?? entry.runnerPid
  return pid ? `pid ${pid}` : 'no pid'
}

export function formatDockerSummary(project: ProjectSummary) {
  return project.docker ? `${project.docker.running} run / ${formatMib(project.docker.memMib)}` : 'none'
}

export function listenerDetailLabel(listener: ListenerPort, projectById: Map<string, ProjectSummary>) {
  if (listener.classification === 'ignored') return listener.classificationReason ?? 'Ignored'
  if (listener.projectId) return projectById.get(listener.projectId)?.displayName ?? listener.projectId
  return listenerSourceLabel(listener)
}

export function projectPortSourceSummary(summary: ProjectPortSummary): string {
  const dockerPorts = summary.ports.filter((port) => port.source === 'docker' || port.source === 'both').length
  const listenerPorts = summary.ports.filter((port) => port.source === 'listener' || port.source === 'both').length
  return `${plural(listenerPorts, 'listener')} / ${plural(dockerPorts, 'Docker port')}`
}

export function dialogTitle(dialog: Exclude<WorkbenchDialog, null>): string {
  if (dialog === 'fleet') return 'Projects'
  if (dialog === 'ports') return 'Ports'
  if (dialog === 'history') return 'Launch history'
  if (dialog === 'git') return 'Git'
  if (dialog === 'docker') return 'Docker'
  return 'Listeners'
}

export function dialogSubtitle(
  dialog: Exclude<WorkbenchDialog, null>,
  snapshot: LocalSuiteSnapshot,
  project: ProjectSummary | null,
): string {
  if (dialog === 'fleet') return plural(snapshot.projects.length, 'project')
  if (dialog === 'ports') return `${plural(snapshot.listeners.length, 'listener')} / public ${snapshot.docker.publicPortCount}`
  if (dialog === 'history') return project ? project.displayName : 'No project selected'
  if (dialog === 'git') return `${plural(snapshot.summary.dirtyRepos, 'dirty repo')}`
  if (dialog === 'docker') return `${snapshot.docker.runningContainers}/${snapshot.docker.totalContainers} containers`
  return `${plural(summarizeUnresolvedListeners(snapshot.listeners).length, 'unresolved group')}`
}
