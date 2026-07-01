import type { BadgeVariant } from '@astryxdesign/core/Badge'
import type { ActionRequest, LocalSuiteSnapshot, ProjectSummary, RunTarget, SafeAction } from '../../shared/types.ts'
import {
  RUNTIME_ACTION_FIXTURE_PARAM,
  RUNTIME_ACTION_FIXTURES,
  type RuntimeActionFixtureId,
} from './actionStateFixtures.ts'
import {
  actionApprovalLabel,
  actionLabel,
  actionRequestMatches,
  actionReason,
  projectPortItems,
  projectPrimaryCommand,
  statusBadgeVariant,
} from './model.ts'
import type { DetailTab, WorkbenchDialog } from './types.ts'

export type WorkbenchCommand =
  | { kind: 'project'; id: string; projectId: string }
  | {
    disabledReason: string | null
    actionId: SafeAction['id']
    kind: 'action'
    id: string
    projectId: string
    targetId?: string
  }
  | { dialog: WorkbenchDialog; kind: 'view'; id: string }
  | { kind: 'detail'; id: string; tab: DetailTab }
  | { fixtureId: RuntimeActionFixtureId | null; kind: 'fixture'; id: string }

export interface WorkbenchCommandItem {
  auxiliaryData: {
    command: WorkbenchCommand
    group: WorkbenchCommandGroup
  }
  badge?: {
    label: string
    variant: BadgeVariant
  }
  command: WorkbenchCommand
  detail: string
  disabledReason?: string
  id: string
  keywords: string[]
  label: string
  meta?: string
  shortcut?: string
}

type WorkbenchCommandGroup = 'Actions' | 'Project view' | 'Views' | 'Runtime fixtures' | 'Projects'

interface BuildWorkbenchCommandsInput {
  actionPending: boolean
  currentDialog: WorkbenchDialog
  currentDetailTab: DetailTab
  isDev: boolean
  pendingActionApproval: ActionRequest | null
  runtimeActionFixtureId: RuntimeActionFixtureId | null
  selectedProject: ProjectSummary | null
  selectedRunTarget: RunTarget | null
  snapshot: LocalSuiteSnapshot
}

const DETAIL_COMMANDS = [
  { detail: 'Selected project runtime', label: 'Show Run', tab: 'run', keywords: ['run', 'runtime', 'target'] },
  { detail: 'Selected project ports', label: 'Show Ports', tab: 'ports', keywords: ['ports', 'listeners'] },
  { detail: 'Selected project history', label: 'Show History', tab: 'history', keywords: ['history', 'logs', 'launches'] },
  { detail: 'Selected project git state', label: 'Show Git', tab: 'git', keywords: ['git', 'branch', 'dirty'] },
  { detail: 'Selected project config', label: 'Show Config', tab: 'config', keywords: ['config', 'settings', 'project'] },
] satisfies Array<{ detail: string; keywords: string[]; label: string; tab: DetailTab }>

const VIEW_COMMANDS = [
  { detail: 'Exception queue', dialog: null, label: 'Show Exceptions', keywords: ['exceptions', 'risk', 'queue', 'workbench', 'home'] },
  { detail: 'Project list', dialog: 'fleet', label: 'Open Projects', keywords: ['fleet', 'projects'] },
  { detail: 'All listeners and ports', dialog: 'ports', label: 'Open Ports', keywords: ['ports', 'listeners'] },
  { detail: 'Launch history', dialog: 'history', label: 'Open History', keywords: ['history', 'logs', 'launches'] },
  { detail: 'Dirty repos', dialog: 'git', label: 'Open Git', keywords: ['git', 'branch', 'dirty'] },
  { detail: 'Docker containers', dialog: 'docker', label: 'Open Docker', keywords: ['docker', 'containers'] },
  { detail: 'Listener rules', dialog: 'listeners', label: 'Open Listeners', keywords: ['listeners', 'rules', 'ignored'] },
] satisfies Array<{ detail: string; dialog: WorkbenchDialog; keywords: string[]; label: string }>

export function buildWorkbenchCommands(input: BuildWorkbenchCommandsInput): WorkbenchCommandItem[] {
  return [
    ...buildActionCommands(input.selectedProject, input.selectedRunTarget, input.actionPending, input.pendingActionApproval),
    ...buildDetailCommands(input.selectedProject, input.currentDetailTab),
    ...buildViewCommands(input.currentDialog),
    ...buildFixtureCommands(input.isDev, input.runtimeActionFixtureId),
    ...buildProjectCommands(input.snapshot, input.selectedProject),
  ]
}

export function findWorkbenchCommand(
  commands: WorkbenchCommandItem[],
  commandId: string,
): WorkbenchCommandItem | null {
  return commands.find((command) => command.id === commandId) ?? null
}

export function searchForRuntimeActionFixture(
  search: string,
  fixtureId: RuntimeActionFixtureId | null,
): string {
  const params = new URLSearchParams(search)
  if (fixtureId) {
    params.set(RUNTIME_ACTION_FIXTURE_PARAM, fixtureId)
  } else {
    params.delete(RUNTIME_ACTION_FIXTURE_PARAM)
  }
  const nextSearch = params.toString()
  return nextSearch ? `?${nextSearch}` : ''
}

function buildActionCommands(
  selectedProject: ProjectSummary | null,
  selectedRunTarget: RunTarget | null,
  actionPending: boolean,
  pendingActionApproval: ActionRequest | null,
): WorkbenchCommandItem[] {
  if (!selectedProject) return []

  return selectedProject.actions.map((action) => {
    const targetId = action.id === 'script-start' ? selectedRunTarget?.id : undefined
    const disabledReason = actionDisabledReason(action, selectedProject, selectedRunTarget, actionPending)
    const command: WorkbenchCommand = {
      actionId: action.id,
      disabledReason,
      id: `action:${selectedProject.id}:${action.id}:${targetId ?? 'project'}`,
      kind: 'action',
      projectId: selectedProject.id,
      targetId,
    }
    const approvalArmed = actionRequestMatches(pendingActionApproval, command)

    return makeCommandItem({
      badge: approvalArmed
        ? { label: 'approval', variant: 'warning' }
        : disabledReason
          ? { label: 'blocked', variant: 'neutral' }
          : action.kind === 'process'
            ? { label: 'process', variant: 'warning' }
            : undefined,
      command,
      detail: approvalArmed ? 'Click again to run locally.' : disabledReason ?? actionReason(action, selectedRunTarget),
      disabledReason: disabledReason ?? undefined,
      group: 'Actions',
      keywords: compactKeywords(
        action.id,
        action.label,
        action.kind,
        action.reason,
        selectedProject.displayName,
        selectedProject.id,
        selectedRunTarget?.label,
        selectedRunTarget?.commandLabel,
      ),
      label: approvalArmed ? actionApprovalLabel(action, selectedRunTarget) : actionLabel(action, selectedRunTarget),
      meta: selectedProject.displayName,
    })
  })
}

function actionDisabledReason(
  action: SafeAction,
  project: ProjectSummary,
  selectedRunTarget: RunTarget | null,
  actionPending: boolean,
): string | null {
  if (actionPending) return 'Action in progress'
  if (action.id === 'script-start' && !selectedRunTarget) return 'No run target'
  if (action.id === 'script-stop' && project.runtime.status !== 'running') return 'Project is stopped'
  if (action.disabled) return action.reason
  if (action.kind === 'blocked') return action.reason || 'Action blocked'
  return null
}

function buildDetailCommands(
  selectedProject: ProjectSummary | null,
  currentDetailTab: DetailTab,
): WorkbenchCommandItem[] {
  return DETAIL_COMMANDS.map((detailCommand) => {
    const disabledReason = selectedProject ? undefined : 'No project selected'
    const command: WorkbenchCommand = {
      id: `detail:${detailCommand.tab}`,
      kind: 'detail',
      tab: detailCommand.tab,
    }

    return makeCommandItem({
      badge: currentDetailTab === detailCommand.tab ? { label: 'active', variant: 'blue' } : undefined,
      command,
      detail: disabledReason ?? detailCommand.detail,
      disabledReason,
      group: 'Project view',
      keywords: compactKeywords(detailCommand.keywords, selectedProject?.displayName, selectedProject?.id),
      label: detailCommand.label,
    })
  })
}

function buildViewCommands(currentDialog: WorkbenchDialog): WorkbenchCommandItem[] {
  return VIEW_COMMANDS.map((viewCommand) => {
    const command: WorkbenchCommand = {
      dialog: viewCommand.dialog,
      id: `view:${viewCommand.dialog ?? 'exceptions'}`,
      kind: 'view',
    }

    return makeCommandItem({
      badge: currentDialog === viewCommand.dialog ? { label: 'open', variant: 'blue' } : undefined,
      command,
      detail: viewCommand.detail,
      group: 'Views',
      keywords: viewCommand.keywords,
      label: viewCommand.label,
    })
  })
}

function buildFixtureCommands(
  isDev: boolean,
  runtimeActionFixtureId: RuntimeActionFixtureId | null,
): WorkbenchCommandItem[] {
  if (!isDev) return []

  const fixtureCommands = RUNTIME_ACTION_FIXTURES.map((fixtureId) => {
    const command: WorkbenchCommand = {
      fixtureId,
      id: `fixture:${fixtureId}`,
      kind: 'fixture',
    }

    return makeCommandItem({
      badge: runtimeActionFixtureId === fixtureId ? { label: 'active', variant: 'warning' } : undefined,
      command,
      detail: runtimeFixtureDetail(fixtureId),
      group: 'Runtime fixtures',
      keywords: compactKeywords(fixtureId, 'runtime', 'fixture', runtimeFixtureDetail(fixtureId)),
      label: runtimeFixtureLabel(fixtureId),
    })
  })

  if (!runtimeActionFixtureId) return fixtureCommands

  const clearCommand: WorkbenchCommand = {
    fixtureId: null,
    id: 'fixture:clear',
    kind: 'fixture',
  }

  return [
    makeCommandItem({
      badge: { label: 'active', variant: 'warning' },
      command: clearCommand,
      detail: 'Return to live state',
      group: 'Runtime fixtures',
      keywords: ['clear', 'fixture', 'live', RUNTIME_ACTION_FIXTURE_PARAM],
      label: 'Clear Fixture',
    }),
    ...fixtureCommands,
  ]
}

function buildProjectCommands(
  snapshot: LocalSuiteSnapshot,
  selectedProject: ProjectSummary | null,
): WorkbenchCommandItem[] {
  return rankProjects(snapshot, selectedProject).map((project) => {
    const badge = projectBadge(project, snapshot, selectedProject)
    const ports = projectPortItems(project, snapshot.listeners)
    const command: WorkbenchCommand = {
      id: `project:${project.id}`,
      kind: 'project',
      projectId: project.id,
    }

    return makeCommandItem({
      badge,
      command,
      detail: `${project.kind} / ${projectPrimaryCommand(project)}`,
      group: 'Projects',
      keywords: compactKeywords(
        project.displayName,
        project.id,
        project.path,
        project.kind,
        project.priority,
        project.status,
        project.tags,
        project.package?.scripts,
        project.runtime.targets.map((target) => [target.label, target.commandLabel, target.script]),
        ports.map((port) => [port.port, port.bindIp, port.scope, port.source]),
        project.git.branch,
        project.git.status,
      ),
      label: project.displayName,
      meta: project.runtime.status === 'running' ? project.runtime.stopReason : project.git.branch ?? project.status,
    })
  })
}

function rankProjects(snapshot: LocalSuiteSnapshot, selectedProject: ProjectSummary | null): ProjectSummary[] {
  return [...snapshot.projects].sort((left, right) => {
    return (
      projectRank(left, snapshot, selectedProject) - projectRank(right, snapshot, selectedProject) ||
      left.displayName.localeCompare(right.displayName)
    )
  })
}

function projectRank(
  project: ProjectSummary,
  snapshot: LocalSuiteSnapshot,
  selectedProject: ProjectSummary | null,
): number {
  if (selectedProject?.id === project.id) return 0
  if (project.runtime.status === 'running') return 1
  if (project.git.dirtyCount > 0) return 2
  if (projectHasPublicPort(project, snapshot)) return 3
  if (project.status === 'attention') return 4
  return 5
}

function projectBadge(
  project: ProjectSummary,
  snapshot: LocalSuiteSnapshot,
  selectedProject: ProjectSummary | null,
): WorkbenchCommandItem['badge'] {
  if (selectedProject?.id === project.id) return { label: 'selected', variant: 'blue' }
  if (project.runtime.status === 'running') return { label: 'running', variant: 'success' }
  if (project.git.dirtyCount > 0) return { label: String(project.git.dirtyCount), variant: 'warning' }
  if (projectHasPublicPort(project, snapshot)) return { label: 'public', variant: 'warning' }
  return { label: project.status, variant: statusBadgeVariant(project.status) }
}

function projectHasPublicPort(project: ProjectSummary, snapshot: LocalSuiteSnapshot): boolean {
  return projectPortItems(project, snapshot.listeners).some((port) => port.scope === 'public')
}

function runtimeFixtureLabel(fixtureId: RuntimeActionFixtureId): string {
  if (fixtureId === 'pending-start') return 'Show Pending Start'
  if (fixtureId === 'stop-success') return 'Show Stop Success'
  if (fixtureId === 'start-failed') return 'Show Start Failed'
  return 'Show Stale Process'
}

function runtimeFixtureDetail(fixtureId: RuntimeActionFixtureId): string {
  if (fixtureId === 'pending-start') return 'Fixture: pending start'
  if (fixtureId === 'stop-success') return 'Fixture: stop success'
  if (fixtureId === 'start-failed') return 'Fixture: start failed'
  return 'Fixture: stale process'
}

function makeCommandItem(input: {
  badge?: WorkbenchCommandItem['badge']
  command: WorkbenchCommand
  detail: string
  disabledReason?: string
  group: WorkbenchCommandGroup
  keywords: string[]
  label: string
  meta?: string
  shortcut?: string
}): WorkbenchCommandItem {
  return {
    auxiliaryData: {
      command: input.command,
      group: input.group,
    },
    badge: input.badge,
    command: input.command,
    detail: input.detail,
    disabledReason: input.disabledReason,
    id: input.command.id,
    keywords: input.keywords,
    label: input.label,
    meta: input.meta,
    shortcut: input.shortcut,
  }
}

function compactKeywords(...values: Array<unknown>): string[] {
  const keywords = values.flatMap(flattenKeywordValue)
  return Array.from(new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean)))
}

function flattenKeywordValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(flattenKeywordValue)
  if (typeof value === 'string') return [value]
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  return []
}
