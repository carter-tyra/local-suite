import { Button } from '@astryxdesign/core/Button'
import { Grid } from '@astryxdesign/core/Grid'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import { Section } from '@astryxdesign/core/Section'
import { StatusDot as AstryxStatusDot } from '@astryxdesign/core/StatusDot'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { Text } from '@astryxdesign/core/Text'
import { Toolbar } from '@astryxdesign/core/Toolbar'
import { VStack } from '@astryxdesign/core/VStack'
import { Branch, ContainerRuntime, Flow, Renew, ShieldAlert } from '@carbon/icons-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { countListenersByFilter } from '../../listenerFilters.ts'
import { summarizeUnresolvedListeners } from '../../portCorrelations.ts'
import { formatDuration, formatMib, formatTime } from '../../format.ts'
import type { DockerStateInfo, LocalSuiteSnapshot, ProjectSummary } from '../../shared/types.ts'
import { eventDotVariant, projectEvents } from './model.ts'
import type { DockerRefreshControlState, ProjectEvent, WorkbenchDialog } from './types.ts'
import { MAX_VISIBLE_EVENTS } from './types.ts'
import type { WorkbenchException } from './exceptionModel.ts'

type EvidenceTab = 'evidence' | 'events' | 'topology'

export function EvidenceRail({
  dockerRefresh,
  onDialogOpen,
  project,
  selectedException,
  snapshot,
}: {
  dockerRefresh: DockerRefreshControlState | null
  onDialogOpen: (dialog: WorkbenchDialog) => void
  project: ProjectSummary | null
  selectedException: WorkbenchException
  snapshot: LocalSuiteSnapshot
}) {
  const [tab, setTab] = useState<EvidenceTab>('evidence')

  return (
    <Section aria-label="Evidence" className="evidence-rail" padding={0} variant="transparent">
      <Toolbar
        className="evidence-toolbar"
        endContent={<Button label="Ports" onClick={() => onDialogOpen('ports')} size="sm" variant="ghost" />}
        label="Evidence"
        size="sm"
        startContent={<Heading level={2}>Evidence</Heading>}
        variant="transparent"
      />
      <TabList hasDivider onChange={(value) => setTab(toEvidenceTab(value))} size="sm" value={tab}>
        <Tab label="Issue" value="evidence" />
        <Tab label="Events" value="events" />
        <Tab label="Topology" value="topology" />
      </TabList>
      <Section className="evidence-content" padding={2} variant="transparent">
        {tab === 'evidence' ? (
          <EvidencePanel onDialogOpen={onDialogOpen} selectedException={selectedException} snapshot={snapshot} />
        ) : null}
        {tab === 'events' ? <EventsPanel project={project} snapshot={snapshot} /> : null}
        {tab === 'topology' ? <TopologyPanel project={project} snapshot={snapshot} /> : null}
      </Section>
      <Section className="evidence-system" padding={2} variant="transparent">
        <DockerPanel dockerRefresh={dockerRefresh} onDialogOpen={onDialogOpen} snapshot={snapshot} />
      </Section>
    </Section>
  )
}

function EvidencePanel({
  selectedException,
  snapshot,
  onDialogOpen,
}: {
  onDialogOpen: (dialog: WorkbenchDialog) => void
  selectedException: WorkbenchException
  snapshot: LocalSuiteSnapshot
}) {
  const listenerCounts = countListenersByFilter(snapshot.listeners)
  const unresolvedCount = summarizeUnresolvedListeners(snapshot.listeners).reduce((sum, item) => sum + item.count, 0)

  return (
    <VStack gap={2}>
      <Section className={`evidence-card tone-${selectedException.tone}`} padding={1.5} variant="transparent">
        <VStack gap={0.5}>
          <HStack align="center" gap={1} justify="between">
            <Text weight="semibold">{selectedException.title}</Text>
            <Text color="secondary" hasTabularNumbers type="supporting">{selectedException.count}</Text>
          </HStack>
          <Text color="secondary" type="supporting">{selectedException.detail}</Text>
        </VStack>
      </Section>
      <VStack gap={1}>
        {selectedException.evidence.map((item) => (
          <HStack align="center" className={`evidence-row tone-${item.tone}`} gap={1.5} justify="between" key={`${item.label}-${item.value}-${item.detail}`}>
            <HStack align="center" gap={1}>
              <AstryxStatusDot label={`${item.label} ${item.value}`} variant={eventDotVariant(item.tone)} />
              <VStack gap={0}>
                <Text maxLines={1} weight="semibold">{item.label}</Text>
                <Text color="secondary" maxLines={1} type="supporting">{item.detail}</Text>
              </VStack>
            </HStack>
            <Text color="secondary" hasTabularNumbers maxLines={1} type="supporting">{item.value}</Text>
          </HStack>
        ))}
      </VStack>
      <Grid columns={{ minWidth: 120 }} gap={1}>
        <MetricCell label="Public" tone={listenerCounts['external-public'] ? 'error' : 'success'} value={String(listenerCounts['external-public'])} />
        <MetricCell label="Unresolved" tone={unresolvedCount ? 'error' : 'success'} value={String(unresolvedCount)} />
        <MetricCell label="Local Suite" tone="success" value={String(listenerCounts['local-suite'])} />
      </Grid>
      {selectedException.dialog ? (
        <Button label={selectedException.actionLabel} onClick={() => onDialogOpen(selectedException.dialog)} size="sm" variant="secondary" />
      ) : null}
    </VStack>
  )
}

function EventsPanel({ project, snapshot }: { project: ProjectSummary | null; snapshot: LocalSuiteSnapshot }) {
  const events = project ? projectEvents(project, snapshot).slice(0, MAX_VISIBLE_EVENTS) : []

  return (
    <VStack gap={1}>
      {events.length ? events.map((event, index) => (
        <HStack align="start" className="evidence-row" gap={1.5} key={`${event.title}-${event.meta}-${index}`}>
          <AstryxStatusDot label={event.title} variant={eventDotVariant(event.tone)} />
          <VStack gap={0}>
            <Text maxLines={1} weight="semibold">{event.title}</Text>
            <Text color="secondary" maxLines={1} type="supporting">{event.detail}</Text>
          </VStack>
          <Text className="event-meta" color="secondary" hasTabularNumbers type="supporting">{event.meta}</Text>
        </HStack>
      )) : (
        <Text color="secondary" type="supporting">No events</Text>
      )}
    </VStack>
  )
}

function TopologyPanel({ project, snapshot }: { project: ProjectSummary | null; snapshot: LocalSuiteSnapshot }) {
  if (!project) return <Text color="secondary" type="supporting">No project selected</Text>

  const ports = [
    ...(project.docker?.ports.map((port) => `${port.hostIp}:${port.hostPort}`) ?? []),
    ...project.runtime.ownedProcesses.map((process) => process.port ? `${process.bindIp ?? '*'}:${process.port}` : ''),
  ].filter(Boolean)
  const uniquePorts = Array.from(new Set(ports)).slice(0, 5)

  return (
    <VStack gap={1.5}>
      <TopologyNode icon={<Flow size={16} />} label={project.displayName} value={project.kind} />
      <TopologyNode
        icon={<ContainerRuntime size={16} />}
        label="Runtime"
        value={project.runtime.status === 'running' ? `${project.runtime.ownedProcesses.length} processes` : 'stopped'}
      />
      <TopologyNode
        icon={<ShieldAlert size={16} />}
        label="Ports"
        value={uniquePorts.length ? uniquePorts.join(', ') : 'none'}
      />
      <TopologyNode icon={<Branch size={16} />} label="Git" value={project.git.branch ?? project.git.status} />
      <Text color="secondary" type="supporting">
        {snapshot.dockerState.source} Docker state / {formatDuration(snapshot.dockerState.ageMs)} old
      </Text>
    </VStack>
  )
}

function DockerPanel({
  snapshot,
  dockerRefresh,
  onDialogOpen,
}: {
  dockerRefresh: DockerRefreshControlState | null
  onDialogOpen: (dialog: WorkbenchDialog) => void
  snapshot: LocalSuiteSnapshot
}) {
  const memoryMax = snapshot.docker.memoryLimitMib ?? Math.max(snapshot.docker.memMib, 1)
  const memoryVariant = snapshot.docker.memMib / memoryMax > 0.7 ? 'warning' : 'success'

  return (
    <VStack gap={1.5}>
      <HStack align="center" justify="between">
        <HStack align="center" gap={1}>
          <ContainerRuntime size={16} />
          <Text weight="semibold">Docker</Text>
        </HStack>
        <Button label="Open Docker" onClick={() => onDialogOpen('docker')} size="sm" variant="ghost" />
      </HStack>
      <ProgressBar
        formatValueLabel={(value, max) => `${formatMib(value)} / ${formatMib(max)}`}
        hasValueLabel
        label="Docker memory"
        max={memoryMax}
        value={snapshot.docker.memMib}
        variant={memoryVariant}
      />
      <Grid columns={{ minWidth: 104 }} gap={1}>
        <MetricCell label="Containers" tone="success" value={`${snapshot.docker.runningContainers}/${snapshot.docker.totalContainers}`} />
        <MetricCell label="Public" tone={snapshot.docker.publicPortCount ? 'warning' : 'success'} value={String(snapshot.docker.publicPortCount)} />
      </Grid>
      {dockerRefresh ? <DockerRefreshControl dockerState={snapshot.dockerState} refresh={dockerRefresh} /> : null}
    </VStack>
  )
}

function DockerRefreshControl({
  dockerState,
  refresh,
}: {
  dockerState: DockerStateInfo
  refresh: DockerRefreshControlState
}) {
  const isCached = dockerState.source === 'cached'
  const status = refresh.isPending
    ? 'Refreshing'
    : refresh.error
      ? refresh.error
      : refresh.refreshedAt
        ? `Fresh ${formatTime(refresh.refreshedAt)}`
        : `${formatDuration(dockerState.ageMs)} old`

  return (
    <Section className="docker-refresh" padding={1.5} variant="transparent">
      <HStack align="center" gap={1} justify="between">
        <HStack align="center" gap={1}>
          <AstryxStatusDot label={`Docker ${dockerState.source}`} variant={isCached ? 'neutral' : 'success'} />
          <Text color="secondary" hasTabularNumbers type="supporting">Docker {dockerState.source}</Text>
        </HStack>
        <Button
          icon={<Renew size={16} />}
          isDisabled={refresh.isPending}
          isLoading={refresh.isPending}
          label="Refresh"
          onClick={refresh.onRefresh}
          size="sm"
          variant="ghost"
        />
      </HStack>
      <Text color="secondary" hasTabularNumbers role={refresh.error ? 'alert' : undefined} type="supporting">
        {status}
      </Text>
    </Section>
  )
}

function TopologyNode({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <HStack align="center" className="topology-node" gap={1.5} justify="between">
      <HStack align="center" gap={1}>
        {icon}
        <Text weight="semibold">{label}</Text>
      </HStack>
      <Text color="secondary" hasTabularNumbers maxLines={1} type="supporting">{value}</Text>
    </HStack>
  )
}

function MetricCell({ label, value, tone }: { label: string; tone: ProjectEvent['tone']; value: string }) {
  return (
    <VStack className={`summary-cell tone-${tone}`} gap={0.5}>
      <Text color="secondary" type="supporting">{label}</Text>
      <Text hasTabularNumbers weight="semibold">{value}</Text>
    </VStack>
  )
}

function toEvidenceTab(value: string): EvidenceTab {
  if (value === 'events' || value === 'topology') return value
  return 'evidence'
}
