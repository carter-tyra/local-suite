import type { ListenerPort, ProjectSummary, SafeActionId } from '../../shared/types.ts'
import type { ProjectPortSummary, UnresolvedListenerReviewItem } from '../../portCorrelations.ts'

export type DetailTab = 'run' | 'ports' | 'history' | 'git' | 'config'
export type WorkbenchDialog = 'fleet' | 'ports' | 'history' | 'git' | 'docker' | 'listeners' | null
export type ProjectTableRow = ProjectSummary & Record<string, unknown>
export type ListenerTableRow = ListenerPort & { tableKey: string } & Record<string, unknown>
export type UnresolvedListenerTableRow = UnresolvedListenerReviewItem & Record<string, unknown>
export type ProjectPortTableRow = ProjectPortSummary & { projectName: string } & Record<string, unknown>

export interface DockerRefreshControlState {
  error: string | null
  isPending: boolean
  onRefresh: () => void
  refreshedAt: string | null
}

export interface ProjectEvent {
  detail: string
  meta: string
  tone: 'success' | 'warning' | 'error' | 'neutral'
  title: string
}

export interface RuntimeActionState {
  actionId: SafeActionId | null
  detail: string
  phase: 'idle' | 'pending' | 'success' | 'failed' | 'stale'
  projectId: string
  source?: 'fixture'
  title: string
  tone: ProjectEvent['tone']
}

export const MAX_RAIL_PROJECTS = 18
export const MAX_VISIBLE_EVENTS = 11
export const MAX_VISIBLE_LISTENERS = 14
export const MAX_VISIBLE_PROJECT_PORTS = 7
