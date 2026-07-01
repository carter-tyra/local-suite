import { useEffect, useMemo, useRef, useState } from 'react'
import { AppShell } from '@astryxdesign/core/AppShell'
import { Section } from '@astryxdesign/core/Section'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchSnapshot, runAction } from './api.ts'
import './App.css'
import {
  filterProjects,
  getProjectKindFilters,
  toFleetKindFilter,
  type FleetKindFilter,
  type FleetStatusFilter,
} from './fleetFilters.ts'
import type { ActionRequest, ActionResult, SafeAction } from './shared/types.ts'
import { ControlDock } from './components/workbench/ControlDock.tsx'
import { EvidenceRail } from './components/workbench/EvidenceRail.tsx'
import { ExceptionsWorkbench } from './components/workbench/ExceptionsWorkbench.tsx'
import { LoadingState, ErrorState, WorkbenchSideNav, WorkbenchTopNav } from './components/workbench/Navigation.tsx'
import { ProjectRail } from './components/workbench/ProjectRail.tsx'
import { WorkbenchDetailsDialog } from './components/workbench/WorkbenchDetailsDialog.tsx'
import { createRuntimeActionFixture, runtimeActionFixtureFromSearch } from './components/workbench/actionStateFixtures.ts'
import { WorkbenchCommandPalette } from './components/workbench/CommandPalette.tsx'
import { searchForRuntimeActionFixture, type WorkbenchCommand } from './components/workbench/commandPaletteModel.ts'
import { buildWorkbenchExceptions, selectedExceptionFrom } from './components/workbench/exceptionModel.ts'
import { runTargetForProject, runtimeActionState, toDetailTab } from './components/workbench/model.ts'
import type { DetailTab, DockerRefreshControlState, WorkbenchDialog } from './components/workbench/types.ts'

async function refreshDockerDiagnosticsInDev() {
  if (import.meta.env.DEV) {
    const { refreshDockerDiagnostics } = await import('./devApi.ts')
    return await refreshDockerDiagnostics()
  }
  throw new Error('Docker refresh is dev-only.')
}

function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [runTargetByProject, setRunTargetByProject] = useState<Record<string, string>>({})
  const [fleetKind, setFleetKind] = useState<FleetKindFilter>('all')
  const [fleetQuery, setFleetQuery] = useState('')
  const [fleetStatus, setFleetStatus] = useState<FleetStatusFilter>('all')
  const [detailTab, setDetailTab] = useState<DetailTab>('run')
  const [dialog, setDialog] = useState<WorkbenchDialog>(null)
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [selectedExceptionId, setSelectedExceptionId] = useState<string | null>(null)
  const [runtimeActionFixtureSearch, setRuntimeActionFixtureSearch] = useState(() => window.location.search)
  const [lastActionRequest, setLastActionRequest] = useState<ActionRequest | null>(null)
  const [actionResult, setActionResult] = useState<ActionResult | null>(null)
  const commandPaletteTriggerRef = useRef<HTMLButtonElement>(null)
  const queryClient = useQueryClient()

  const snapshotQuery = useQuery({
    queryKey: ['snapshot'],
    queryFn: fetchSnapshot,
    refetchInterval: 15_000,
  })
  const actionMutation = useMutation({
    mutationFn: runAction,
    onMutate: (request) => {
      setLastActionRequest(request)
      setActionResult(null)
    },
    onSuccess: (result) => {
      setActionResult(result)
      void queryClient.invalidateQueries({ queryKey: ['snapshot'] })
    },
  })
  const dockerRefreshMutation = useMutation({
    mutationFn: refreshDockerDiagnosticsInDev,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['snapshot'] })
    },
  })

  const snapshot = snapshotQuery.data
  const workbenchExceptions = useMemo(() => snapshot ? buildWorkbenchExceptions(snapshot) : [], [snapshot])
  const selectedException = workbenchExceptions.length
    ? selectedExceptionFrom(workbenchExceptions, selectedExceptionId)
    : null
  const projectById = useMemo(() => new Map((snapshot?.projects ?? []).map((project) => [project.id, project])), [snapshot?.projects])
  const projectKindFilters = useMemo(() => getProjectKindFilters(snapshot?.projects ?? []), [snapshot?.projects])
  const normalizedFleetKind = snapshot ? toFleetKindFilter(fleetKind, snapshot.projects) : fleetKind
  const filteredProjects = useMemo(() => {
    if (!snapshot) return []
    return filterProjects(snapshot.projects, { kind: normalizedFleetKind, query: fleetQuery, status: fleetStatus })
  }, [fleetQuery, fleetStatus, normalizedFleetKind, snapshot])
  const selectedProject = useMemo(() => {
    if (!snapshot) return null
    const exceptionProject = selectedException?.primaryProjectId ? projectById.get(selectedException.primaryProjectId) ?? null : null
    return filteredProjects.find((project) => project.id === selectedId) ?? exceptionProject ?? filteredProjects[0] ?? snapshot.projects[0] ?? null
  }, [filteredProjects, projectById, selectedException, selectedId, snapshot])
  const selectedRunTargetId = useMemo(() => {
    if (!selectedProject) return ''
    const savedTargetId = runTargetByProject[selectedProject.id]
    const savedTargetStillExists = selectedProject.runtime.targets.some((target) => target.id === savedTargetId)
    if (savedTargetId && savedTargetStillExists) return savedTargetId
    return selectedProject.runtime.primaryTarget?.id ?? ''
  }, [runTargetByProject, selectedProject])
  const selectedRunTarget = selectedProject ? runTargetForProject(selectedProject, selectedRunTargetId) : null
  const runtimeActionFixtureId = import.meta.env.DEV
    ? runtimeActionFixtureFromSearch(runtimeActionFixtureSearch)
    : null
  const runtimeActionFixture = selectedProject && runtimeActionFixtureId
    ? createRuntimeActionFixture({
        id: runtimeActionFixtureId,
        project: selectedProject,
        selectedRunTarget,
      })
    : null
  const actionError = actionMutation.error instanceof Error ? actionMutation.error.message : null
  const pendingActionRequest = actionMutation.isPending
    ? actionMutation.variables ?? lastActionRequest
    : null
  const liveRuntimeActionState = selectedProject
    ? runtimeActionState({
        actionError,
        actionResult,
        lastRequest: lastActionRequest,
        pendingRequest: pendingActionRequest,
        project: selectedProject,
        selectedRunTarget,
      })
    : null
  const selectedRuntimeActionState = runtimeActionFixture?.state ?? liveRuntimeActionState
  const displayedSelectedProject = runtimeActionFixture?.project ?? selectedProject
  const displayedActionPending = runtimeActionFixture?.actionPending ?? actionMutation.isPending
  const displayedActionRequest = runtimeActionFixture?.actionRequest ?? pendingActionRequest
  const displayedActionError = runtimeActionFixture?.actionError ?? actionError
  const displayedActionResult = runtimeActionFixture?.actionResult ?? actionResult
  const dockerRefreshControl: DockerRefreshControlState | null = import.meta.env.DEV
    ? {
        error: dockerRefreshMutation.error instanceof Error ? dockerRefreshMutation.error.message : null,
        isPending: dockerRefreshMutation.isPending,
        onRefresh: () => dockerRefreshMutation.mutate(),
        refreshedAt: dockerRefreshMutation.data?.snapshot?.dockerState.generatedAt ?? null,
      }
    : null

  const handleAction = (actionId: SafeAction['id'], projectId?: string, targetId?: string) => {
    actionMutation.mutate({
      actionId,
      projectId,
      targetId: actionId === 'script-start' ? targetId : undefined,
    })
  }

  const closeCommandPalette = () => {
    setCommandPaletteOpen(false)
    window.setTimeout(() => commandPaletteTriggerRef.current?.focus(), 0)
  }

  const setRuntimeActionFixture = (fixtureId: typeof runtimeActionFixtureId) => {
    const nextSearch = searchForRuntimeActionFixture(window.location.search, fixtureId)
    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`
    window.history.replaceState(window.history.state, '', nextUrl)
    setRuntimeActionFixtureSearch(nextSearch)
  }

  const handleCommandSelect = (command: WorkbenchCommand) => {
    if (command.kind === 'project') {
      setFleetKind('all')
      setFleetQuery('')
      setFleetStatus('all')
      setSelectedId(command.projectId)
      setDialog(null)
      return
    }

    if (command.kind === 'action') {
      if (command.disabledReason) return
      handleAction(command.actionId, command.projectId, command.targetId)
      return
    }

    if (command.kind === 'view') {
      setDialog(command.dialog)
      return
    }

    if (command.kind === 'detail') {
      setDetailTab(command.tab)
      setDialog(null)
      return
    }

    if (command.kind === 'fixture') {
      setRuntimeActionFixture(command.fixtureId)
      setDialog(null)
      return
    }

    assertNever(command)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandPaletteOpen(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    const handlePopState = () => setRuntimeActionFixtureSearch(window.location.search)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  return (
    <AppShell
      className="workbench-shell"
      contentPadding={0}
      height="fill"
      sideNav={
        <WorkbenchSideNav
          onDialogOpen={setDialog}
          selectedDialog={dialog}
          snapshot={snapshot ?? null}
        />
      }
      topNav={
        <WorkbenchTopNav
          commandPaletteTriggerRef={commandPaletteTriggerRef}
          isFetching={snapshotQuery.isFetching}
          onCommandPaletteOpen={() => setCommandPaletteOpen(true)}
          onDialogOpen={setDialog}
          onRefresh={() => void snapshotQuery.refetch()}
          onSearchChange={setFleetQuery}
          searchValue={fleetQuery}
          snapshot={snapshot ?? null}
        />
      }
      variant="section"
    >
      {snapshotQuery.isPending ? (
        <LoadingState />
      ) : snapshotQuery.isError ? (
        <ErrorState message={snapshotQuery.error.message} />
      ) : snapshot ? (
        <>
          <Section aria-label="Local Suite workbench" className="workbench-grid" padding={0} variant="transparent">
            <ProjectRail
              filterKind={normalizedFleetKind}
              filterStatus={fleetStatus}
              kindFilters={projectKindFilters}
              onDialogOpen={setDialog}
              onFilterKindChange={setFleetKind}
              onFilterStatusChange={setFleetStatus}
              onQueryChange={setFleetQuery}
              onResetFilters={() => {
                setFleetKind('all')
                setFleetQuery('')
                setFleetStatus('all')
              }}
              onSelect={setSelectedId}
              projects={filteredProjects}
              query={fleetQuery}
              selectedId={selectedProject?.id ?? null}
              totalProjects={snapshot.projects}
            />
            {selectedException ? (
              <ExceptionsWorkbench
                actionPending={displayedActionPending}
                actionRequest={displayedActionRequest}
                actionState={selectedRuntimeActionState}
                exceptions={workbenchExceptions}
                onAction={handleAction}
                onDialogOpen={setDialog}
                onSelectException={setSelectedExceptionId}
                onSelectProject={setSelectedId}
                project={displayedSelectedProject}
                projectById={projectById}
                selectedException={selectedException}
                selectedRunTarget={selectedRunTarget}
              />
            ) : null}
            {selectedException ? (
              <EvidenceRail
                dockerRefresh={dockerRefreshControl}
                onDialogOpen={setDialog}
                project={displayedSelectedProject}
                selectedException={selectedException}
                snapshot={snapshot}
              />
            ) : null}
          </Section>
          <ControlDock
            actionError={displayedActionError}
            actionPending={displayedActionPending}
            actionRequest={displayedActionRequest}
            actionResult={displayedActionResult}
            actionState={selectedRuntimeActionState}
            detailTab={detailTab}
            onAction={handleAction}
            onDialogOpen={setDialog}
            onRunTargetChange={(projectId, targetId) => {
              setRunTargetByProject((current) => ({ ...current, [projectId]: targetId }))
            }}
            onTabChange={(tab) => setDetailTab(toDetailTab(tab))}
            project={displayedSelectedProject}
            selectedRunTarget={selectedRunTarget}
            selectedRunTargetId={selectedRunTargetId}
            snapshot={snapshot}
          />
          <WorkbenchDetailsDialog
            actionResult={displayedActionResult}
            dialog={dialog}
            onClose={() => setDialog(null)}
            project={displayedSelectedProject}
            snapshot={snapshot}
          />
          <WorkbenchCommandPalette
            actionPending={actionMutation.isPending}
            currentDetailTab={detailTab}
            currentDialog={dialog}
            isDev={import.meta.env.DEV}
            isOpen={isCommandPaletteOpen}
            onCommandSelect={handleCommandSelect}
            onOpenChange={(isOpen) => {
              if (isOpen) {
                setCommandPaletteOpen(true)
                return
              }
              closeCommandPalette()
            }}
            runtimeActionFixtureId={runtimeActionFixtureId}
            selectedProject={selectedProject}
            selectedRunTarget={selectedRunTarget}
            snapshot={snapshot}
          />
        </>
      ) : null}
    </AppShell>
  )
}

function assertNever(value: never): never {
  throw new Error(`Unhandled command: ${JSON.stringify(value)}`)
}

export default App
