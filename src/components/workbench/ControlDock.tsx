import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Code } from '@astryxdesign/core/Code'
import { Grid } from '@astryxdesign/core/Grid'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList'
import { Selector } from '@astryxdesign/core/Selector'
import { Section } from '@astryxdesign/core/Section'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { Box, Play, StopOutline, Terminal } from '@carbon/icons-react'
import type { ActionRequest, ActionResult, LocalSuiteSnapshot, ProjectSummary, RunTarget, SafeAction } from '../../shared/types.ts'
import {
  actionLabel,
  actionReason,
  projectPortItems,
  projectPrimaryCommand,
  runtimeActionBadgeVariant,
  runTargetSelectorOptions,
} from './model.ts'
import {
  ActionIcon,
  ActionOutput,
  HistoryRow,
  ProcessRow,
  ProjectStatusBadge,
} from './shared.tsx'
import type { DetailTab, RuntimeActionState, WorkbenchDialog } from './types.ts'

export function ControlDock({
  project,
  snapshot,
  detailTab,
  selectedRunTarget,
  selectedRunTargetId,
  actionPending,
  actionRequest,
  actionError,
  actionResult,
  actionState,
  onTabChange,
  onRunTargetChange,
  onAction,
  onDialogOpen,
}: {
  project: ProjectSummary | null
  snapshot: LocalSuiteSnapshot
  detailTab: DetailTab
  selectedRunTarget: RunTarget | null
  selectedRunTargetId: string
  actionPending: boolean
  actionRequest: ActionRequest | null
  actionError: string | null
  actionResult: ActionResult | null
  actionState: RuntimeActionState | null
  onTabChange: (tab: string) => void
  onRunTargetChange: (projectId: string, targetId: string) => void
  onAction: (actionId: SafeAction['id'], projectId?: string, targetId?: string) => void
  onDialogOpen: (dialog: WorkbenchDialog) => void
}) {
  if (!project) return null

  return (
    <Section aria-label="Selected project" className="control-dock" padding={0} variant="transparent">
      <Section className="dock-heading" padding={1.5} variant="transparent">
        <HStack align="center" gap={1.5} justify="between" wrap="wrap">
          <HStack align="center" gap={1.5}>
            <Box size={20} />
            <VStack gap={0}>
              <HStack align="center" gap={1}>
                <Heading level={2} maxLines={1}>{project.displayName}</Heading>
                <ProjectStatusBadge status={project.status} />
                {actionState?.actionId ? <Badge label={actionState.title} variant={runtimeActionBadgeVariant(actionState)} /> : null}
              </HStack>
              <Text color="secondary" maxLines={1} type="supporting">
                {projectPrimaryCommand(project)} / {project.git.isRepo ? project.git.branch ?? 'detached' : 'no git'}
              </Text>
            </VStack>
          </HStack>
          <HStack align="center" gap={1} wrap="wrap">
            <Button
              icon={<Play size={16} />}
              isDisabled={actionPending || !selectedRunTarget}
              isLoading={actionPending && actionRequest?.actionId === 'script-start'}
              label={selectedRunTarget?.label ?? 'Start'}
              onClick={() => onAction('script-start', project.id, selectedRunTarget?.id)}
              size="sm"
              variant="primary"
            />
            <Button
              icon={<StopOutline size={16} />}
              isDisabled={actionPending || project.runtime.status !== 'running'}
              isLoading={actionPending && actionRequest?.actionId === 'script-stop'}
              label="Stop"
              onClick={() => onAction('script-stop', project.id)}
              size="sm"
              variant="destructive"
            />
            <Button icon={<Terminal size={16} />} label="Logs" onClick={() => onDialogOpen('history')} size="sm" variant="secondary" />
          </HStack>
        </HStack>
      </Section>
      <Section className="dock-body" padding={0} variant="transparent">
        <Section className="dock-tabs" padding={0} variant="transparent">
          <TabList hasDivider onChange={onTabChange} size="sm" value={detailTab}>
            <Tab label="Run" value="run" />
            <Tab label="Ports" value="ports" />
            <Tab label="History" value="history" />
            <Tab label="Git" value="git" />
            <Tab label="Config" value="config" />
          </TabList>
        </Section>
        <Section className="dock-content" padding={1.5} variant="transparent">
          {detailTab === 'run' ? (
            <RunDock
              actionError={actionError}
              actionPending={actionPending}
              actionRequest={actionRequest}
              actionState={actionState}
              onAction={onAction}
              onRunTargetChange={onRunTargetChange}
              project={project}
              selectedRunTarget={selectedRunTarget}
              selectedRunTargetId={selectedRunTargetId}
            />
          ) : null}
          {detailTab === 'ports' ? (
            <PortsDock onOpen={() => onDialogOpen('ports')} project={project} snapshot={snapshot} />
          ) : null}
          {detailTab === 'history' ? (
            <HistoryDock actionResult={actionResult} onOpen={() => onDialogOpen('history')} project={project} />
          ) : null}
          {detailTab === 'git' ? <GitDock onOpen={() => onDialogOpen('git')} project={project} /> : null}
          {detailTab === 'config' ? <ConfigDock onOpen={() => onDialogOpen('fleet')} project={project} /> : null}
        </Section>
      </Section>
    </Section>
  )
}

function RunDock({
  project,
  selectedRunTarget,
  selectedRunTargetId,
  actionPending,
  actionRequest,
  actionState,
  actionError,
  onRunTargetChange,
  onAction,
}: {
  project: ProjectSummary
  selectedRunTarget: RunTarget | null
  selectedRunTargetId: string
  actionPending: boolean
  actionRequest: ActionRequest | null
  actionState: RuntimeActionState | null
  actionError: string | null
  onRunTargetChange: (projectId: string, targetId: string) => void
  onAction: (actionId: SafeAction['id'], projectId?: string, targetId?: string) => void
}) {
  return (
    <Grid columns={{ minWidth: 260, max: 3 }} gap={1.5}>
      <VStack gap={1}>
        <Text color="secondary" type="label">Run target</Text>
        {project.runtime.targets.length ? (
          <Selector
            hasSearch={project.runtime.targets.length > 8}
            label="Run target"
            onChange={(targetId) => onRunTargetChange(project.id, targetId)}
            options={runTargetSelectorOptions(project.runtime.targets)}
            placeholder="Run target"
            searchPlaceholder="Search scripts"
            size="sm"
            value={selectedRunTargetId}
          />
        ) : (
          <Text color="secondary" type="supporting">No scripts</Text>
        )}
        <Code className="command-code">{selectedRunTarget?.commandLabel ?? 'No run target'}</Code>
        {actionState ? <RuntimeStatePanel state={actionState} /> : null}
      </VStack>
      <VStack gap={1}>
        <Text color="secondary" type="label">Safe actions</Text>
        <Grid className="dock-actions" columns={{ minWidth: 140, max: 2 }} gap={1}>
          {project.actions.map((action) => {
            const isStartAction = action.id === 'script-start'
            const isActionPending = actionPending && actionRequest?.actionId === action.id
            return (
              <Button
                icon={<ActionIcon action={action} isPending={isActionPending} />}
                isDisabled={action.disabled || actionPending || (isStartAction && !selectedRunTarget)}
                key={action.id}
                label={actionLabel(action, selectedRunTarget)}
                onClick={() => onAction(action.id, project.id, isStartAction ? selectedRunTarget?.id : undefined)}
                size="sm"
                tooltip={actionReason(action, selectedRunTarget)}
                variant={isStartAction && !action.disabled ? 'primary' : action.kind === 'process' ? 'destructive' : 'secondary'}
              />
            )
          })}
        </Grid>
        {actionError ? <Text color="secondary" role="alert" type="supporting">{actionError}</Text> : null}
      </VStack>
      <VStack gap={1}>
        <Text color="secondary" type="label">Processes</Text>
        {project.runtime.ownedProcesses.length ? (
          project.runtime.ownedProcesses.slice(0, 4).map((process) => (
            <ProcessRow key={`${process.pid}-${process.port ?? 'none'}`} process={process} />
          ))
        ) : (
          <Text color="secondary" type="supporting">No owned process</Text>
        )}
      </VStack>
    </Grid>
  )
}

function RuntimeStatePanel({ state }: { state: RuntimeActionState }) {
  return (
    <Section className={`action-state tone-${state.tone}`} padding={1} variant="transparent">
      <HStack align="start" gap={1} justify="between">
        <VStack gap={0}>
          <Text maxLines={1} weight="semibold">{state.title}</Text>
          <Text color="secondary" maxLines={2} type="supporting">{state.detail}</Text>
        </VStack>
        <HStack align="center" gap={0.5}>
          {state.source === 'fixture' ? <Badge label="fixture" variant="neutral" /> : null}
          <Badge label={state.phase} variant={runtimeActionBadgeVariant(state)} />
        </HStack>
      </HStack>
    </Section>
  )
}

function PortsDock({
  project,
  snapshot,
  onOpen,
}: {
  project: ProjectSummary
  snapshot: LocalSuiteSnapshot
  onOpen: () => void
}) {
  const ports = projectPortItems(project, snapshot.listeners)
  return (
    <VStack gap={1.5}>
      <HStack align="center" justify="between">
        <Text color="secondary" type="label">Active ports</Text>
        <Button label="View all ports" onClick={onOpen} size="sm" variant="ghost" />
      </HStack>
      <Grid columns={{ minWidth: 160 }} gap={1}>
        {ports.length ? ports.slice(0, 6).map((port) => (
          <Section className={`port-chip tone-${port.scope === 'public' ? 'warning' : 'success'}`} key={`${port.bindIp}-${port.port}`} padding={1} variant="transparent">
            <HStack align="center" gap={1} justify="between">
              <Text hasTabularNumbers weight="semibold">{port.port}</Text>
              <Text color="secondary" maxLines={1} type="supporting">{port.scope}</Text>
            </HStack>
          </Section>
        )) : (
          <Text color="secondary" type="supporting">No active ports</Text>
        )}
      </Grid>
    </VStack>
  )
}

function HistoryDock({
  project,
  actionResult,
  onOpen,
}: {
  project: ProjectSummary
  actionResult: ActionResult | null
  onOpen: () => void
}) {
  return (
    <Grid columns={{ minWidth: 280, max: 2 }} gap={1.5}>
      <VStack gap={1}>
        <HStack align="center" justify="between">
          <Text color="secondary" type="label">Launch history</Text>
          <Button label="Open history" onClick={onOpen} size="sm" variant="ghost" />
        </HStack>
        {project.runtime.history.slice(0, 4).map((entry) => <HistoryRow entry={entry} key={entry.entryId} />)}
        {!project.runtime.history.length ? <Text color="secondary" type="supporting">No tracked launches</Text> : null}
      </VStack>
      {actionResult ? <ActionOutput result={actionResult} /> : (
        <Text color="secondary" type="supporting">No action output</Text>
      )}
    </Grid>
  )
}

export function GitDock({ project, onOpen }: { project: ProjectSummary; onOpen: () => void }) {
  return (
    <VStack gap={1.5}>
      <HStack align="center" justify="between">
        <Text color="secondary" type="label">Git</Text>
        <Button label="Open Git" onClick={onOpen} size="sm" variant="ghost" />
      </HStack>
      <MetadataList columns="multi" label={{ position: 'top' }}>
        <MetadataListItem label="Branch">{project.git.branch ?? 'detached'}</MetadataListItem>
        <MetadataListItem label="Status">{project.git.status}</MetadataListItem>
        <MetadataListItem label="Dirty">{project.git.dirtyCount}</MetadataListItem>
        <MetadataListItem label="Untracked">{project.git.untrackedCount}</MetadataListItem>
      </MetadataList>
    </VStack>
  )
}

function ConfigDock({ project, onOpen }: { project: ProjectSummary; onOpen: () => void }) {
  return (
    <VStack gap={1.5}>
      <HStack align="center" justify="between">
        <Text color="secondary" type="label">Project config</Text>
        <Button label="Open project list" onClick={onOpen} size="sm" variant="ghost" />
      </HStack>
      <MetadataList columns="multi" label={{ position: 'top' }}>
        <MetadataListItem label="Path"><Text className="break-anywhere">{project.path}</Text></MetadataListItem>
        <MetadataListItem label="Source">{project.source}</MetadataListItem>
        <MetadataListItem label="Priority">{project.priority}</MetadataListItem>
        <MetadataListItem label="Package">{project.package?.packageName ?? 'none'}</MetadataListItem>
      </MetadataList>
    </VStack>
  )
}
