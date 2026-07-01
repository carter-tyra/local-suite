import type { BadgeVariant } from '@astryxdesign/core/Badge'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Grid } from '@astryxdesign/core/Grid'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Section } from '@astryxdesign/core/Section'
import { StatusDot as AstryxStatusDot } from '@astryxdesign/core/StatusDot'
import { Text } from '@astryxdesign/core/Text'
import { Toolbar } from '@astryxdesign/core/Toolbar'
import { VStack } from '@astryxdesign/core/VStack'
import { CheckmarkOutline, ListChecked, Warning } from '@carbon/icons-react'
import type { ActionRequest, ProjectSummary, RunTarget, SafeAction } from '../../shared/types.ts'
import {
  actionApprovalLabel,
  actionLabel,
  actionRequestMatches,
  actionReason,
  eventDotVariant,
  projectPrimaryCommand,
  runtimeActionBadgeVariant,
} from './model.ts'
import { ActionIcon, MetricPill, ProjectStatusBadge } from './shared.tsx'
import type { RuntimeActionState, WorkbenchDialog } from './types.ts'
import {
  severityLabel,
  type WorkbenchException,
} from './exceptionModel.ts'

export function ExceptionsWorkbench({
  actionPending,
  actionRequest,
  actionState,
  exceptions,
  onAction,
  onDialogOpen,
  onSelectException,
  onSelectProject,
  pendingActionApproval,
  project,
  projectById,
  selectedException,
  selectedRunTarget,
}: {
  actionPending: boolean
  actionRequest: ActionRequest | null
  actionState: RuntimeActionState | null
  exceptions: WorkbenchException[]
  onAction: (actionId: SafeAction['id'], projectId?: string, targetId?: string) => void
  onDialogOpen: (dialog: WorkbenchDialog) => void
  onSelectException: (exceptionId: string) => void
  onSelectProject: (projectId: string) => void
  pendingActionApproval: ActionRequest | null
  project: ProjectSummary | null
  projectById: Map<string, ProjectSummary>
  selectedException: WorkbenchException
  selectedRunTarget: RunTarget | null
}) {
  const activeExceptions = exceptions.filter((exception) => exception.kind !== 'all-clear')
  const affectedProjects = selectedException.projectIds
    .map((projectId) => projectById.get(projectId))
    .filter((item): item is ProjectSummary => Boolean(item))

  return (
    <Section aria-label="Exceptions" className="exception-workbench" padding={0} variant="transparent">
      <Toolbar
        className="exception-toolbar"
        endContent={
          <HStack align="center" gap={1} wrap="wrap">
            <MetricPill label="exceptions" tone={activeExceptions.length ? 'error' : 'success'} value={String(activeExceptions.length)} />
            <MetricPill label="high" tone="error" value={String(activeExceptions.filter((exception) => exception.severity === 'high').length)} />
          </HStack>
        }
        label="Exceptions"
        size="sm"
        startContent={
          <HStack align="center" gap={1}>
            <ListChecked size={16} />
            <Heading level={2}>Exceptions</Heading>
          </HStack>
        }
        variant="transparent"
      />
      <Section className="exception-layout" padding={0} variant="transparent">
        <ExceptionQueue
          exceptions={exceptions}
          onDialogOpen={onDialogOpen}
          onSelectException={onSelectException}
          onSelectProject={onSelectProject}
          selectedException={selectedException}
        />
        <ProjectInspector
          actionPending={actionPending}
          actionRequest={actionRequest}
          actionState={actionState}
          affectedProjects={affectedProjects}
          exception={selectedException}
          onAction={onAction}
          onDialogOpen={onDialogOpen}
          onSelectProject={onSelectProject}
          pendingActionApproval={pendingActionApproval}
          project={project}
          selectedRunTarget={selectedRunTarget}
        />
      </Section>
    </Section>
  )
}

function ExceptionQueue({
  exceptions,
  selectedException,
  onSelectException,
  onSelectProject,
  onDialogOpen,
}: {
  exceptions: WorkbenchException[]
  selectedException: WorkbenchException
  onDialogOpen: (dialog: WorkbenchDialog) => void
  onSelectException: (exceptionId: string) => void
  onSelectProject: (projectId: string) => void
}) {
  return (
    <Section aria-label="Exception queue" className="exception-queue" padding={2} variant="transparent">
      <VStack gap={1.5}>
        <HStack align="center" justify="between">
          <VStack gap={0}>
            <Text color="secondary" type="label">Risk queue</Text>
            <Text color="secondary" type="supporting">{exceptions.length ? 'Ranked by severity' : 'No issues'}</Text>
          </VStack>
          {selectedException.dialog ? (
            <Button label={selectedException.actionLabel} onClick={() => onDialogOpen(selectedException.dialog)} size="sm" variant="secondary" />
          ) : null}
        </HStack>
        <VStack gap={1}>
          {exceptions.map((exception) => (
            <Button
              className={`exception-row tone-${exception.tone}${exception.id === selectedException.id ? ' is-selected' : ''}`}
              key={exception.id}
              label={`Select ${exception.title}`}
              onClick={() => {
                onSelectException(exception.id)
                if (exception.primaryProjectId) onSelectProject(exception.primaryProjectId)
              }}
              size="sm"
              variant="ghost"
            >
              <HStack align="center" gap={1.5} justify="between" width="100%">
                <HStack align="center" gap={1.5}>
                  <AstryxStatusDot label={`${exception.title} ${severityLabel(exception.severity)}`} variant={eventDotVariant(exception.tone)} />
                  <VStack gap={0}>
                    <Text maxLines={1} weight="semibold">{exception.title}</Text>
                    <Text color="secondary" hasTabularNumbers maxLines={1} type="supporting">{exception.detail}</Text>
                  </VStack>
                </HStack>
                <HStack align="center" gap={1}>
                  <Badge label={String(exception.count)} variant={badgeForSeverity(exception.severity)} />
                  <Text className="risk-label" color="secondary" type="supporting">{severityLabel(exception.severity)}</Text>
                </HStack>
              </HStack>
            </Button>
          ))}
        </VStack>
      </VStack>
    </Section>
  )
}

function ProjectInspector({
  project,
  exception,
  affectedProjects,
  actionPending,
  actionRequest,
  actionState,
  selectedRunTarget,
  onAction,
  onDialogOpen,
  onSelectProject,
  pendingActionApproval,
}: {
  actionPending: boolean
  actionRequest: ActionRequest | null
  actionState: RuntimeActionState | null
  affectedProjects: ProjectSummary[]
  exception: WorkbenchException
  onAction: (actionId: SafeAction['id'], projectId?: string, targetId?: string) => void
  onDialogOpen: (dialog: WorkbenchDialog) => void
  onSelectProject: (projectId: string) => void
  pendingActionApproval: ActionRequest | null
  project: ProjectSummary | null
  selectedRunTarget: RunTarget | null
}) {
  if (!project) {
    return (
      <Section className="project-inspector" padding={2} variant="transparent">
        <EmptyState headingLevel={2} icon={<CheckmarkOutline size={20} />} isCompact title="No project selected" />
      </Section>
    )
  }

  return (
    <Section aria-label="Project inspector" className="project-inspector" padding={2} variant="transparent">
      <VStack gap={2}>
        <HStack align="start" justify="between">
          <VStack gap={0.5}>
            <HStack align="center" gap={1} wrap="wrap">
              <Heading level={2} maxLines={1}>{project.displayName}</Heading>
              <ProjectStatusBadge status={project.status} />
              {actionState ? <Badge label={actionState.title} variant={runtimeActionBadgeVariant(actionState)} /> : null}
            </HStack>
            <Text color="secondary" maxLines={1} type="supporting">
              {project.kind} / {projectPrimaryCommand(project)}
            </Text>
          </VStack>
          <Badge label={severityLabel(exception.severity)} variant={badgeForSeverity(exception.severity)} />
        </HStack>

        <Section className={`exception-focus tone-${exception.tone}`} padding={1.5} variant="transparent">
          <HStack align="start" gap={1.5}>
            <Warning size={16} />
            <VStack gap={0.5}>
              <Text weight="semibold">{exception.title}</Text>
              <Text color="secondary" type="supporting">{exception.detail}</Text>
            </VStack>
          </HStack>
        </Section>

        <SafeActionGrid
          actionPending={actionPending}
          actionRequest={actionRequest}
          onAction={onAction}
          pendingActionApproval={pendingActionApproval}
          project={project}
          selectedRunTarget={selectedRunTarget}
        />

        <VStack gap={1}>
          <HStack align="center" justify="between">
            <Text color="secondary" type="label">Affected projects</Text>
            <Button label="Open projects" onClick={() => onDialogOpen('fleet')} size="sm" variant="ghost" />
          </HStack>
          {affectedProjects.length ? (
            <Grid columns={{ minWidth: 168, max: 2 }} gap={1}>
              {affectedProjects.slice(0, 6).map((affectedProject) => (
                <Button
                  className={`affected-project${affectedProject.id === project.id ? ' is-selected' : ''}`}
                  key={affectedProject.id}
                  label={`Select ${affectedProject.displayName}`}
                  onClick={() => onSelectProject(affectedProject.id)}
                  size="sm"
                  variant="ghost"
                >
                  <VStack gap={0} width="100%">
                    <Text maxLines={1} weight="semibold">{affectedProject.displayName}</Text>
                    <Text color="secondary" maxLines={1} type="supporting">{affectedProject.kind}</Text>
                  </VStack>
                </Button>
              ))}
            </Grid>
          ) : (
            <Text color="secondary" type="supporting">No matched project</Text>
          )}
        </VStack>
      </VStack>
    </Section>
  )
}

function SafeActionGrid({
  project,
  selectedRunTarget,
  actionPending,
  actionRequest,
  onAction,
  pendingActionApproval,
}: {
  actionPending: boolean
  actionRequest: ActionRequest | null
  onAction: (actionId: SafeAction['id'], projectId?: string, targetId?: string) => void
  pendingActionApproval: ActionRequest | null
  project: ProjectSummary
  selectedRunTarget: RunTarget | null
}) {
  const approvalArmed = project.actions.some((action) => {
    const isStartAction = action.id === 'script-start'
    return actionRequestMatches(pendingActionApproval, {
      actionId: action.id,
      projectId: project.id,
      targetId: isStartAction ? selectedRunTarget?.id : undefined,
    })
  })

  return (
    <VStack gap={1}>
      <HStack align="center" justify="between">
        <Text color="secondary" type="label">Safe actions</Text>
        {approvalArmed ? <Badge label="approval needed" variant="warning" /> : null}
      </HStack>
      <Grid className="inspector-actions" columns={{ minWidth: 132, max: 2 }} gap={1}>
        {project.actions.map((action) => {
          const isStartAction = action.id === 'script-start'
          const isActionPending = actionPending && actionRequest?.actionId === action.id
          const request: ActionRequest = {
            actionId: action.id,
            projectId: project.id,
            targetId: isStartAction ? selectedRunTarget?.id : undefined,
          }
          const isApprovalArmed = actionRequestMatches(pendingActionApproval, request)
          const disabled = action.disabled || actionPending || (isStartAction && !selectedRunTarget) || (action.id === 'script-stop' && project.runtime.status !== 'running')
          return (
            <Button
              icon={<ActionIcon action={action} isPending={isActionPending} />}
              isDisabled={disabled}
              isLoading={isActionPending}
              key={action.id}
              label={isApprovalArmed ? actionApprovalLabel(action, selectedRunTarget) : actionLabel(action, selectedRunTarget)}
              onClick={() => onAction(action.id, project.id, isStartAction ? selectedRunTarget?.id : undefined)}
              size="sm"
              tooltip={isApprovalArmed ? 'Click again to approve' : actionReason(action, selectedRunTarget)}
              variant={isStartAction && !action.disabled ? 'primary' : action.kind === 'process' ? 'destructive' : 'secondary'}
            />
          )
        })}
      </Grid>
      {approvalArmed ? (
        <Section className="action-approval-note" padding={1} variant="transparent">
          <Text color="secondary" type="supporting">Click again to run locally.</Text>
        </Section>
      ) : null}
    </VStack>
  )
}

function badgeForSeverity(severity: WorkbenchException['severity']): BadgeVariant {
  if (severity === 'high') return 'error'
  if (severity === 'medium') return 'warning'
  if (severity === 'low') return 'success'
  return 'success'
}
