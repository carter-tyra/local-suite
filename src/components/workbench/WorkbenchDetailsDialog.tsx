import { useMemo, useState } from 'react'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Code } from '@astryxdesign/core/Code'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList'
import { Section } from '@astryxdesign/core/Section'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { StatusDot as AstryxStatusDot } from '@astryxdesign/core/StatusDot'
import { Table, pixel, proportional, type TableColumn } from '@astryxdesign/core/Table'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Security } from '@carbon/icons-react'
import { ignoreListenerRule, previewIgnoredListenerRule } from '../../api.ts'
import { LISTENER_FILTERS, countListenersByFilter, filterListeners, sortListenersForDisplay, toListenerFilter, type ListenerFilter } from '../../listenerFilters.ts'
import { countResolvedListeners, summarizeProjectPorts, summarizeUnresolvedListeners, type ProjectPortSummary, type UnresolvedListenerReviewItem } from '../../portCorrelations.ts'
import { formatMib, plural } from '../../format.ts'
import type { ActionResult, ListenerRuleMutationResult, ListenerRulePreview, LocalSuiteSnapshot, ProjectSummary } from '../../shared/types.ts'
import {
  dialogSubtitle,
  dialogTitle,
  formatDockerSummary,
  listenerDetailLabel,
  projectPrimaryCommand,
  projectPortSourceSummary,
  statusScopeVariant,
} from './model.ts'
import { GitDock } from './ControlDock.tsx'
import { ActionOutput, HistoryRow, ProjectStatusDot } from './shared.tsx'
import type {
  ListenerTableRow,
  ProjectPortTableRow,
  ProjectTableRow,
  UnresolvedListenerTableRow,
  WorkbenchDialog,
} from './types.ts'
import { MAX_VISIBLE_LISTENERS, MAX_VISIBLE_PROJECT_PORTS } from './types.ts'

export function WorkbenchDetailsDialog({
  dialog,
  snapshot,
  project,
  actionResult,
  onClose,
}: {
  dialog: WorkbenchDialog
  snapshot: LocalSuiteSnapshot
  project: ProjectSummary | null
  actionResult: ActionResult | null
  onClose: () => void
}) {
  if (!dialog) return null

  const title = dialogTitle(dialog)
  const subtitle = dialogSubtitle(dialog, snapshot, project)
  const isWide = dialog === 'fleet' || dialog === 'ports' || dialog === 'listeners'

  return (
    <Dialog
      className={`workbench-dialog dialog-${dialog}`}
      isOpen
      maxHeight="calc(100dvh - 48px)"
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      position={{ bottom: 16, right: 16, top: 16 }}
      purpose="info"
      width={isWide ? 'min(1120px, calc(100dvw - 32px))' : 'min(760px, calc(100dvw - 32px))'}
    >
      <DialogHeader onOpenChange={() => onClose()} subtitle={subtitle} title={title} />
      <Section className="dialog-body" padding={2} variant="transparent">
        {dialog === 'fleet' ? <FleetDialog snapshot={snapshot} /> : null}
        {dialog === 'ports' ? <PortsDialog snapshot={snapshot} /> : null}
        {dialog === 'history' ? <HistoryDialog actionResult={actionResult} project={project} /> : null}
        {dialog === 'git' ? <GitDialog project={project} snapshot={snapshot} /> : null}
        {dialog === 'docker' ? <DockerDialog project={project} snapshot={snapshot} /> : null}
        {dialog === 'listeners' ? <PortsDialog snapshot={snapshot} startFilter="external-public" /> : null}
      </Section>
    </Dialog>
  )
}

function FleetDialog({ snapshot }: { snapshot: LocalSuiteSnapshot }) {
  const rows = snapshot.projects as ProjectTableRow[]
  const columns: TableColumn<ProjectTableRow>[] = [
    {
      key: 'displayName',
      header: 'Project',
      width: proportional(2, { minWidth: 240 }),
      renderCell: (project) => (
        <VStack gap={0}>
          <Text maxLines={1} weight="semibold">{project.displayName}</Text>
          <Text color="secondary" maxLines={1} type="supporting">{project.kind} / {project.path}</Text>
        </VStack>
      ),
    },
    {
      key: 'runtime',
      header: 'Runtime',
      width: proportional(1, { minWidth: 150 }),
      renderCell: (project) => (
        <HStack align="center" gap={1}>
          <ProjectStatusDot status={project.status} />
          <Text maxLines={1}>{project.runtime.status}</Text>
        </HStack>
      ),
    },
    {
      key: 'command',
      header: 'Command',
      width: proportional(1, { minWidth: 180 }),
      renderCell: (project) => <Text maxLines={1}>{projectPrimaryCommand(project)}</Text>,
    },
    {
      key: 'git',
      header: 'Git',
      width: proportional(1, { minWidth: 160 }),
      renderCell: (project) => (
        <Text maxLines={1}>{project.git.isRepo ? `${project.git.branch ?? 'detached'} / ${project.git.status}` : 'not repo'}</Text>
      ),
    },
    {
      key: 'docker',
      header: 'Docker',
      width: proportional(1, { minWidth: 140 }),
      renderCell: (project) => <Text hasTabularNumbers maxLines={1}>{formatDockerSummary(project)}</Text>,
    },
  ]

  return (
    <Section className="table-scroll" padding={0} variant="transparent">
      <Table
        aria-label="Projects"
        className="workbench-table"
        columns={columns}
        data={rows}
        density="compact"
        dividers="rows"
        hasHover
        idKey="id"
        textOverflow="truncate"
      />
    </Section>
  )
}

function PortsDialog({
  snapshot,
  startFilter = 'external-public',
}: {
  snapshot: LocalSuiteSnapshot
  startFilter?: ListenerFilter
}) {
  const [listenerFilter, setListenerFilter] = useState<ListenerFilter>(startFilter)
  const [listenerRuleResult, setListenerRuleResult] = useState<ListenerRulePreview | ListenerRuleMutationResult | null>(null)
  const queryClient = useQueryClient()
  const projectById = useMemo(() => new Map(snapshot.projects.map((project) => [project.id, project])), [snapshot.projects])
  const projectPortSummaries = useMemo(() => summarizeProjectPorts(snapshot.projects, snapshot.listeners), [snapshot.listeners, snapshot.projects])
  const unresolvedListeners = useMemo(() => summarizeUnresolvedListeners(snapshot.listeners), [snapshot.listeners])
  const listenerCounts = countListenersByFilter(snapshot.listeners)
  const resolvedListeners = countResolvedListeners(snapshot.listeners)
  const displayedListeners = sortListenersForDisplay(filterListeners(snapshot.listeners, listenerFilter))
  const listenerRows: ListenerTableRow[] = displayedListeners.slice(0, MAX_VISIBLE_LISTENERS).map((listener, index) => ({
    ...listener,
    tableKey: `${listener.pid}-${listener.port}-${listener.command}-${listener.bindIp}-${index}`,
  }))
  const previewRuleMutation = useMutation({
    mutationFn: previewIgnoredListenerRule,
    onSuccess: setListenerRuleResult,
  })
  const ignoreRuleMutation = useMutation({
    mutationFn: ignoreListenerRule,
    onSuccess: (result) => {
      setListenerRuleResult(result)
      void queryClient.invalidateQueries({ queryKey: ['snapshot'] })
    },
  })
  const listenerRuleError =
    previewRuleMutation.error instanceof Error
      ? previewRuleMutation.error.message
      : ignoreRuleMutation.error instanceof Error
        ? ignoreRuleMutation.error.message
        : null

  return (
    <VStack gap={2}>
      <HStack align="center" gap={1} wrap="wrap">
        <Badge label={`${listenerCounts['external-public']} external`} variant={listenerCounts['external-public'] ? 'warning' : 'neutral'} />
        <Badge label={`${listenerCounts['local-suite']} Local Suite`} variant="blue" />
        <Badge label={`${resolvedListeners} resolved`} variant="neutral" />
        <Badge label={`${unresolvedListeners.length} unresolved`} variant={unresolvedListeners.length ? 'warning' : 'neutral'} />
      </HStack>
      <SegmentedControl
        className="listener-filter"
        label="Listener filter"
        onChange={(value) => setListenerFilter(toListenerFilter(value))}
        size="sm"
        value={listenerFilter}
      >
        {LISTENER_FILTERS.map((filter) => (
          <SegmentedControlItem
            key={filter.value}
            label={`${filter.label} ${listenerCounts[filter.value]}`}
            value={filter.value}
          />
        ))}
      </SegmentedControl>
      <ListenerTable listeners={listenerRows} projectById={projectById} />
      <UnresolvedListenersPanel
        applyPendingKey={ignoreRuleMutation.isPending ? ignoreRuleMutation.variables?.key ?? null : null}
        error={listenerRuleError}
        items={unresolvedListeners}
        onApplyIgnore={(item) => ignoreRuleMutation.mutate(item)}
        onPreviewIgnore={(item) => previewRuleMutation.mutate(item)}
        previewPendingKey={previewRuleMutation.isPending ? previewRuleMutation.variables?.key ?? null : null}
        result={listenerRuleResult}
      />
      <ProjectPortsPanel projectById={projectById} summaries={projectPortSummaries} />
    </VStack>
  )
}

function ListenerTable({
  listeners,
  projectById,
}: {
  listeners: ListenerTableRow[]
  projectById: Map<string, ProjectSummary>
}) {
  const columns: TableColumn<ListenerTableRow>[] = [
    {
      key: 'port',
      header: 'Port',
      width: pixel(92),
      renderCell: (listener) => (
        <HStack align="center" gap={1}>
          <AstryxStatusDot label={`${listener.scope} listener`} variant={statusScopeVariant(listener.scope)} />
          <Text hasTabularNumbers weight="semibold">{listener.port}</Text>
        </HStack>
      ),
    },
    {
      key: 'command',
      header: 'Process',
      width: proportional(2, { minWidth: 240 }),
      renderCell: (listener) => (
        <VStack className="listener-command" gap={0}>
          <Text maxLines={1}>{listener.command}</Text>
          <Text color="secondary" maxLines={1} type="supporting">{listenerDetailLabel(listener, projectById)}</Text>
        </VStack>
      ),
    },
    {
      key: 'scope',
      header: 'Scope',
      width: pixel(120),
      renderCell: (listener) => <Badge label={listener.scope} variant={listener.scope === 'public' ? 'warning' : 'neutral'} />,
    },
    {
      key: 'bindIp',
      header: 'Bind',
      width: proportional(1, { minWidth: 150 }),
      renderCell: (listener) => <Code>{listener.bindIp}</Code>,
    },
  ]

  if (!listeners.length) return <EmptyState headingLevel={3} isCompact title="No listeners" />

  return (
    <Section className="table-scroll" padding={0} variant="transparent">
      <Table
        aria-label="Listeners"
        className="workbench-table"
        columns={columns}
        data={listeners}
        density="compact"
        dividers="rows"
        hasHover
        idKey="tableKey"
        textOverflow="truncate"
      />
    </Section>
  )
}

function UnresolvedListenersPanel({
  items,
  result,
  error,
  previewPendingKey,
  applyPendingKey,
  onPreviewIgnore,
  onApplyIgnore,
}: {
  items: UnresolvedListenerReviewItem[]
  result: ListenerRulePreview | ListenerRuleMutationResult | null
  error: string | null
  previewPendingKey: string | null
  applyPendingKey: string | null
  onPreviewIgnore: (item: UnresolvedListenerReviewItem) => void
  onApplyIgnore: (item: UnresolvedListenerReviewItem) => void
}) {
  if (!items.length) return null

  const columns: TableColumn<UnresolvedListenerTableRow>[] = [
    {
      key: 'port',
      header: 'Listener',
      width: proportional(2, { minWidth: 220 }),
      renderCell: (item) => (
        <HStack align="center" gap={1}>
          <AstryxStatusDot label={`${item.scope} unresolved listener`} variant={statusScopeVariant(item.scope)} />
          <Text hasTabularNumbers weight="semibold">{item.port}</Text>
          <Text maxLines={1}>{item.command}</Text>
        </HStack>
      ),
    },
    {
      key: 'key',
      header: 'Rule',
      width: proportional(3, { minWidth: 260 }),
      renderCell: (item) => <Code className="listener-review-key">{item.key}</Code>,
    },
    {
      key: 'actions',
      header: 'Review',
      width: pixel(184),
      renderCell: (item) => {
        const activeResult = result?.key === item.key ? result : null
        const isApplied = Boolean(activeResult && 'applied' in activeResult && activeResult.applied)
        const canApply = Boolean(activeResult && activeResult.matchingListeners > 0 && !isApplied)

        return (
          <HStack align="center" className="listener-review-actions" gap={0.5}>
            <Button
              icon={<Search size={16} />}
              isDisabled={applyPendingKey !== null}
              isLoading={previewPendingKey === item.key}
              label="Preview"
              onClick={() => onPreviewIgnore(item)}
              size="sm"
              variant="ghost"
            />
            <Button
              icon={<Security size={16} />}
              isDisabled={!canApply || previewPendingKey !== null}
              isLoading={applyPendingKey === item.key}
              label="Ignore"
              onClick={() => onApplyIgnore(item)}
              size="sm"
              tooltip={canApply ? 'Save ignore rule' : 'Preview first'}
              variant={canApply ? 'secondary' : 'ghost'}
            />
            {activeResult ? <Text color="secondary" hasTabularNumbers type="supporting">{isApplied ? 'Ignored' : `${activeResult.matchingListeners} match`}</Text> : null}
          </HStack>
        )
      },
    },
  ]

  return (
    <Section className="dialog-section" padding={1.5} variant="transparent">
      <VStack gap={1.5}>
        <HStack align="center" justify="between">
          <Heading level={3}>Unresolved</Heading>
          <Text color="secondary" hasTabularNumbers type="supporting">{plural(items.length, 'group')}</Text>
        </HStack>
        {error ? <Text color="secondary" role="alert" type="supporting">{error}</Text> : null}
        <Section className="table-scroll" padding={0} variant="transparent">
          <Table
            aria-label="Unresolved listeners"
            className="workbench-table"
            columns={columns}
            data={items as UnresolvedListenerTableRow[]}
            density="compact"
            dividers="rows"
            hasHover
            idKey="key"
            textOverflow="truncate"
          />
        </Section>
      </VStack>
    </Section>
  )
}

function ProjectPortsPanel({
  projectById,
  summaries,
}: {
  projectById: Map<string, ProjectSummary>
  summaries: ProjectPortSummary[]
}) {
  const rows: ProjectPortTableRow[] = summaries.map((summary) => ({
    ...summary,
    projectName: projectById.get(summary.projectId)?.displayName ?? summary.projectId,
  }))
  const columns: TableColumn<ProjectPortTableRow>[] = [
    {
      key: 'projectName',
      header: 'Project',
      width: proportional(2, { minWidth: 220 }),
      renderCell: (summary) => (
        <VStack gap={0}>
          <Text maxLines={1} weight="semibold">{summary.projectName}</Text>
          <Text color="secondary" hasTabularNumbers type="supporting">{plural(summary.ports.length, 'port')}</Text>
        </VStack>
      ),
    },
    {
      key: 'ports',
      header: 'Ports',
      width: proportional(3, { minWidth: 280 }),
      renderCell: (summary) => (
        <HStack className="project-port-chips" gap={0.5} wrap="wrap">
          {summary.ports.slice(0, MAX_VISIBLE_PROJECT_PORTS).map((port) => (
            <Code className="project-port-chip" key={`${summary.projectId}-${port.bindIp}-${port.port}`}>{port.port}</Code>
          ))}
          {summary.ports.length > MAX_VISIBLE_PROJECT_PORTS ? <Text color="secondary" hasTabularNumbers type="supporting">+{summary.ports.length - MAX_VISIBLE_PROJECT_PORTS}</Text> : null}
        </HStack>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      width: proportional(1, { minWidth: 170 }),
      renderCell: (summary) => <Text color="secondary" maxLines={1} type="supporting">{projectPortSourceSummary(summary)}</Text>,
    },
  ]

  if (!rows.length) return null

  return (
    <Section className="dialog-section" padding={1.5} variant="transparent">
      <VStack gap={1.5}>
        <Heading level={3}>Project ports</Heading>
        <Section className="table-scroll" padding={0} variant="transparent">
          <Table
            aria-label="Project ports"
            className="workbench-table"
            columns={columns}
            data={rows}
            density="compact"
            dividers="rows"
            hasHover
            idKey="projectId"
            textOverflow="truncate"
          />
        </Section>
      </VStack>
    </Section>
  )
}

function HistoryDialog({
  project,
  actionResult,
}: {
  project: ProjectSummary | null
  actionResult: ActionResult | null
}) {
  if (!project) return <EmptyState headingLevel={3} isCompact title="No project selected" />

  return (
    <VStack gap={2}>
      <VStack gap={1}>
        {project.runtime.history.length ? project.runtime.history.map((entry) => <HistoryRow entry={entry} key={entry.entryId} />) : (
          <Text color="secondary" type="supporting">No tracked launches</Text>
        )}
      </VStack>
      {actionResult ? <ActionOutput result={actionResult} /> : null}
    </VStack>
  )
}

function GitDialog({
  snapshot,
  project,
}: {
  snapshot: LocalSuiteSnapshot
  project: ProjectSummary | null
}) {
  const dirtyProjects = snapshot.projects.filter((item) => item.git.dirtyCount > 0)

  return (
    <VStack gap={2}>
      {project ? <GitDock onOpen={() => undefined} project={project} /> : null}
      <Section className="dialog-section" padding={1.5} variant="transparent">
        <VStack gap={1.5}>
          <HStack align="center" justify="between">
            <Heading level={3}>Dirty repos</Heading>
            <Badge label={String(dirtyProjects.length)} variant={dirtyProjects.length ? 'warning' : 'neutral'} />
          </HStack>
          {dirtyProjects.slice(0, 12).map((item) => (
            <HStack className="compact-row" gap={1} justify="between" key={item.id}>
              <Text maxLines={1} weight="semibold">{item.displayName}</Text>
              <Text color="secondary" maxLines={1} type="supporting">{item.git.branch ?? 'detached'} / {item.git.dirtyCount}</Text>
            </HStack>
          ))}
        </VStack>
      </Section>
    </VStack>
  )
}

function DockerDialog({
  snapshot,
  project,
}: {
  snapshot: LocalSuiteSnapshot
  project: ProjectSummary | null
}) {
  const containers = project?.docker?.containers ?? snapshot.projects.flatMap((item) => item.docker?.containers ?? [])

  return (
    <VStack gap={2}>
      <MetadataList columns="multi" label={{ position: 'top' }}>
        <MetadataListItem label="Containers">{snapshot.docker.runningContainers}/{snapshot.docker.totalContainers}</MetadataListItem>
        <MetadataListItem label="Memory">{formatMib(snapshot.docker.memMib)} / {snapshot.docker.memoryLimitMib ? formatMib(snapshot.docker.memoryLimitMib) : 'unknown'}</MetadataListItem>
        <MetadataListItem label="Public ports">{snapshot.docker.publicPortCount}</MetadataListItem>
        <MetadataListItem label="State">{snapshot.dockerState.source}</MetadataListItem>
      </MetadataList>
      <VStack gap={1}>
        {containers.slice(0, 12).map((container) => (
          <HStack className="compact-row" gap={1} justify="between" key={container.id}>
            <VStack gap={0}>
              <Text maxLines={1} weight="semibold">{container.name}</Text>
              <Text color="secondary" maxLines={1} type="supporting">{container.service} / {container.image}</Text>
            </VStack>
            <HStack align="center" gap={1}>
              <Badge label={container.running ? 'running' : 'stopped'} variant={container.running ? 'success' : 'neutral'} />
              <Text color="secondary" hasTabularNumbers type="supporting">{formatMib(container.memMib)}</Text>
            </HStack>
          </HStack>
        ))}
      </VStack>
    </VStack>
  )
}
