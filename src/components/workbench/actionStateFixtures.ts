import type { ActionRequest, ActionResult, ProjectRuntimeHistoryEntry, ProjectSummary, RunTarget } from '../../shared/types.ts'
import { runTargetForProject, runtimeActionState } from './model.ts'
import type { RuntimeActionState } from './types.ts'

export const RUNTIME_ACTION_FIXTURE_PARAM = 'runtimeActionFixture'
export const RUNTIME_ACTION_FIXTURES = ['pending-start', 'stop-success', 'start-failed', 'stale'] as const

export type RuntimeActionFixtureId = typeof RUNTIME_ACTION_FIXTURES[number]

export interface RuntimeActionFixture {
  actionError: string | null
  actionPending: boolean
  actionRequest: ActionRequest | null
  actionResult: ActionResult | null
  id: RuntimeActionFixtureId
  project: ProjectSummary
  state: RuntimeActionState
}

export function runtimeActionFixtureFromSearch(search: string): RuntimeActionFixtureId | null {
  const value = new URLSearchParams(search).get(RUNTIME_ACTION_FIXTURE_PARAM)
  return isRuntimeActionFixtureId(value) ? value : null
}

export function createRuntimeActionFixture(input: {
  id: RuntimeActionFixtureId
  now?: string
  project: ProjectSummary
  selectedRunTarget: RunTarget | null
}): RuntimeActionFixture {
  const now = input.now ?? new Date().toISOString()
  const selectedRunTarget = input.selectedRunTarget ?? input.project.runtime.primaryTarget
  const targetId = selectedRunTarget?.id ?? input.project.runtime.primaryTarget?.id

  if (input.id === 'pending-start') {
    const actionRequest = actionRequestForStart(input.project, selectedRunTarget, targetId)
    return buildFixture({
      actionError: null,
      actionPending: true,
      actionRequest,
      actionResult: null,
      id: input.id,
      lastRequest: actionRequest,
      pendingRequest: actionRequest,
      project: input.project,
      selectedRunTarget,
    })
  }

  if (input.id === 'stop-success') {
    const actionRequest: ActionRequest = { actionId: 'script-stop', projectId: input.project.id }
    const actionResult: ActionResult = {
      actionId: 'script-stop',
      command: '/bin/kill -TERM 1234',
      exitCode: 0,
      generatedAt: now,
      projectId: input.project.id,
      redacted: false,
      stderr: '',
      stdout: 'Sent SIGTERM to 1 process.',
    }
    return buildFixture({
      actionError: null,
      actionPending: false,
      actionRequest: null,
      actionResult,
      id: input.id,
      lastRequest: actionRequest,
      pendingRequest: null,
      project: input.project,
      selectedRunTarget,
    })
  }

  if (input.id === 'start-failed') {
    const actionRequest = actionRequestForStart(input.project, selectedRunTarget, targetId)
    return buildFixture({
      actionError: 'Ghostty failed to open.',
      actionPending: false,
      actionRequest: null,
      actionResult: null,
      id: input.id,
      lastRequest: actionRequest,
      pendingRequest: null,
      project: input.project,
      selectedRunTarget,
    })
  }

  const fixtureProject = projectWithStaleRuntime(input.project, selectedRunTarget, targetId, now)
  return buildFixture({
    actionError: null,
    actionPending: false,
    actionRequest: null,
    actionResult: null,
    id: input.id,
    lastRequest: null,
    pendingRequest: null,
    project: fixtureProject,
    selectedRunTarget,
  })
}

function buildFixture(input: {
  actionError: string | null
  actionPending: boolean
  actionRequest: ActionRequest | null
  actionResult: ActionResult | null
  id: RuntimeActionFixtureId
  lastRequest: ActionRequest | null
  pendingRequest: ActionRequest | null
  project: ProjectSummary
  selectedRunTarget: RunTarget | null
}): RuntimeActionFixture {
  return {
    actionError: input.actionError,
    actionPending: input.actionPending,
    actionRequest: input.actionRequest,
    actionResult: input.actionResult,
    id: input.id,
    project: input.project,
    state: {
      ...runtimeActionState({
        actionError: input.actionError,
        actionResult: input.actionResult,
        lastRequest: input.lastRequest,
        pendingRequest: input.pendingRequest,
        project: input.project,
        selectedRunTarget: input.selectedRunTarget,
      }),
      source: 'fixture',
    },
  }
}

function actionRequestForStart(
  project: ProjectSummary,
  selectedRunTarget: RunTarget | null,
  targetId: string | undefined,
): ActionRequest {
  const target = targetId ? runTargetForProject(project, targetId) : selectedRunTarget
  return {
    actionId: 'script-start',
    projectId: project.id,
    targetId: target?.id,
  }
}

function projectWithStaleRuntime(
  project: ProjectSummary,
  selectedRunTarget: RunTarget | null,
  targetId: string | undefined,
  now: string,
): ProjectSummary {
  const target = targetId ? runTargetForProject(project, targetId) : selectedRunTarget ?? project.runtime.primaryTarget
  const staleEntry: ProjectRuntimeHistoryEntry = {
    childPid: null,
    commandLabel: target?.commandLabel ?? project.runtime.primaryTarget?.commandLabel ?? 'No run target',
    entryId: 'fixture-stale-runtime',
    exitCode: null,
    exitedAt: now,
    runnerPid: null,
    script: target?.script ?? project.runtime.primaryTarget?.script ?? 'dev',
    signal: null,
    startedAt: now,
    status: 'stale',
    stopExitCode: null,
    stopRequestedAt: null,
    stopRequestedBy: null,
    stopResult: null,
    stopSignal: null,
    targetId: target?.id ?? project.runtime.primaryTarget?.id ?? 'script:dev',
    updatedAt: now,
  }

  return {
    ...project,
    runtime: {
      ...project.runtime,
      history: [staleEntry, ...project.runtime.history],
    },
  }
}

function isRuntimeActionFixtureId(value: string | null): value is RuntimeActionFixtureId {
  return RUNTIME_ACTION_FIXTURES.some((fixture) => fixture === value)
}
