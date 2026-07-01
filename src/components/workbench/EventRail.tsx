import { Button } from '@astryxdesign/core/Button'
import { Grid } from '@astryxdesign/core/Grid'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Section } from '@astryxdesign/core/Section'
import { StatusDot as AstryxStatusDot } from '@astryxdesign/core/StatusDot'
import { Text } from '@astryxdesign/core/Text'
import { Toolbar } from '@astryxdesign/core/Toolbar'
import { VStack } from '@astryxdesign/core/VStack'
import { ContainerRuntime, Globe, Renew } from '@carbon/icons-react'
import type { ReactNode } from 'react'
import { countListenersByFilter } from '../../listenerFilters.ts'
import { summarizeUnresolvedListeners } from '../../portCorrelations.ts'
import { formatDuration, formatMib, formatTime } from '../../format.ts'
import type { DockerStateInfo, LocalSuiteSnapshot, ProjectSummary } from '../../shared/types.ts'
import { eventDotVariant, projectEvents } from './model.ts'
import { MAX_VISIBLE_EVENTS, type DockerRefreshControlState, type ProjectEvent, type WorkbenchDialog } from './types.ts'

export function EventRail({
  snapshot,
  project,
  dockerRefresh,
  onDialogOpen,
}: {
  snapshot: LocalSuiteSnapshot
  project: ProjectSummary | null
  dockerRefresh: DockerRefreshControlState | null
  onDialogOpen: (dialog: WorkbenchDialog) => void
}) {
  const events = project ? projectEvents(project, snapshot).slice(0, MAX_VISIBLE_EVENTS) : []
  const listenerCounts = countListenersByFilter(snapshot.listeners)
  const unresolvedCount = summarizeUnresolvedListeners(snapshot.listeners).length

  return (
    <Section aria-label="Events" className="event-rail" padding={0} variant="transparent">
      <Toolbar
        endContent={<Button label="All" onClick={() => onDialogOpen('history')} size="sm" variant="ghost" />}
        label="Events"
        size="sm"
        startContent={<Heading level={2}>Events</Heading>}
        variant="transparent"
      />
      <VStack className="event-list" gap={1}>
        {events.length ? events.map((event, index) => (
          <HStack align="start" className="event-row" gap={1.5} key={`${event.title}-${event.meta}-${index}`}>
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
      <VStack className="system-summary" gap={1.5}>
        <SummaryPanel
          actionLabel="View ports"
          icon={<Globe size={16} />}
          onAction={() => onDialogOpen('ports')}
          rows={[
            { label: 'Public', value: String(listenerCounts['external-public']), tone: listenerCounts['external-public'] ? 'warning' : 'neutral' },
            { label: 'Local Suite', value: String(listenerCounts['local-suite']), tone: 'success' },
            { label: 'Unresolved', value: String(unresolvedCount), tone: unresolvedCount ? 'warning' : 'neutral' },
          ]}
          title="Ports"
        />
        <SummaryPanel
          actionLabel="Open Docker"
          icon={<ContainerRuntime size={16} />}
          onAction={() => onDialogOpen('docker')}
          rows={[
            { label: 'Containers', value: `${snapshot.docker.runningContainers}/${snapshot.docker.totalContainers}`, tone: 'success' },
            { label: 'Memory', value: formatMib(snapshot.docker.memMib), tone: 'neutral' },
            { label: 'Public', value: String(snapshot.docker.publicPortCount), tone: snapshot.docker.publicPortCount ? 'warning' : 'neutral' },
          ]}
          title="Docker"
        />
        {dockerRefresh ? <DockerRefreshControl dockerState={snapshot.dockerState} refresh={dockerRefresh} /> : null}
      </VStack>
    </Section>
  )
}

function SummaryPanel({
  title,
  icon,
  rows,
  actionLabel,
  onAction,
}: {
  title: string
  icon: ReactNode
  rows: Array<{ label: string; tone: ProjectEvent['tone']; value: string }>
  actionLabel: string
  onAction: () => void
}) {
  return (
    <Section className="summary-panel" padding={1.5} variant="transparent">
      <VStack gap={1.5}>
        <HStack align="center" justify="between">
          <HStack align="center" gap={1}>
            {icon}
            <Text weight="semibold">{title}</Text>
          </HStack>
          <Button label={actionLabel} onClick={onAction} size="sm" variant="ghost" />
        </HStack>
        <Grid columns={{ minWidth: 96 }} gap={1}>
          {rows.map((row) => (
            <VStack className={`summary-cell tone-${row.tone}`} gap={0.5} key={row.label}>
              <Text color="secondary" type="supporting">{row.label}</Text>
              <Text hasTabularNumbers weight="semibold">{row.value}</Text>
            </VStack>
          ))}
        </Grid>
      </VStack>
    </Section>
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
