import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Section } from '@astryxdesign/core/Section'
import { StatusDot as AstryxStatusDot } from '@astryxdesign/core/StatusDot'
import { Text } from '@astryxdesign/core/Text'
import { Toolbar } from '@astryxdesign/core/Toolbar'
import { VStack } from '@astryxdesign/core/VStack'
import { Box, Flow } from '@carbon/icons-react'
import { formatMib, plural } from '../../format.ts'
import type { LocalSuiteSnapshot, ProjectSummary } from '../../shared/types.ts'
import {
  eventDotVariant,
  isTargetRunning,
  projectPortSummary,
  runtimeActionBadgeVariant,
} from './model.ts'
import { ProjectStatusBadge } from './shared.tsx'
import type { ProjectEvent, RuntimeActionState, WorkbenchDialog } from './types.ts'

export function RunMap({
  project,
  snapshot,
  actionState,
  onDialogOpen,
}: {
  project: ProjectSummary | null
  snapshot: LocalSuiteSnapshot
  actionState: RuntimeActionState | null
  onDialogOpen: (dialog: WorkbenchDialog) => void
}) {
  if (!project) {
    return (
      <Section className="run-map" padding={4} variant="transparent">
        <EmptyState headingLevel={2} isCompact title="No project selected" />
      </Section>
    )
  }

  const targets = project.runtime.targets.slice(0, 3)
  const portSummary = projectPortSummary(project, snapshot.listeners)
  const runtimeTone = actionState?.tone ?? (project.runtime.status === 'running' ? 'success' : 'neutral')
  const runtimeTitle = actionState?.title ?? project.runtime.status
  const runtimeDetail = actionState?.detail ?? (project.runtime.ownedProcesses.length ? plural(project.runtime.ownedProcesses.length, 'process') : 'no process')

  return (
    <Section aria-label="Run map" className="run-map" padding={0} variant="transparent">
      <Toolbar
        className="map-toolbar"
        endContent={
          <HStack align="center" gap={1}>
            <Button label="Ports" onClick={() => onDialogOpen('ports')} size="sm" variant="ghost" />
            <Button label="History" onClick={() => onDialogOpen('history')} size="sm" variant="ghost" />
          </HStack>
        }
        label="Run map"
        size="sm"
        startContent={
          <HStack align="center" gap={1}>
            <Flow size={16} />
            <Heading level={2}>Run map</Heading>
          </HStack>
        }
        variant="transparent"
      />
      <Section className="map-canvas" padding={0} variant="transparent">
        <span aria-hidden className="map-link map-link-top-left" />
        <span aria-hidden className="map-link map-link-top-center" />
        <span aria-hidden className="map-link map-link-top-right" />
        <span aria-hidden className="map-link map-link-left" />
        <span aria-hidden className="map-link map-link-right" />
        <span aria-hidden className="map-link map-link-bottom-left" />
        <span aria-hidden className="map-link map-link-bottom-right" />

        {targets.map((target, index) => (
          <MapNode
            className={`script-node script-node-${index + 1}`}
            detail={target.commandLabel}
            key={target.id}
            meta={isTargetRunning(project, target) ? 'running' : 'ready'}
            tone={isTargetRunning(project, target) ? 'success' : 'neutral'}
            title={target.script}
          />
        ))}
        <MapNode
          className="git-node"
          detail={project.git.isRepo ? project.git.branch ?? 'detached' : 'not repo'}
          meta={project.git.dirtyCount ? `${project.git.dirtyCount} changed` : project.git.status}
          tone={project.git.dirtyCount ? 'warning' : project.git.isRepo ? 'success' : 'neutral'}
          title="Git"
        />
        <MapNode
          className="docker-node"
          detail={project.docker ? plural(project.docker.running, 'container') : 'no stack'}
          meta={project.docker ? formatMib(project.docker.memMib) : 'none'}
          tone={project.docker?.running ? 'success' : 'neutral'}
          title="Docker"
        />
        <MapNode
          className="port-node port-node-left"
          detail={portSummary.primary}
          meta={portSummary.scope}
          tone={portSummary.hasPublic ? 'warning' : portSummary.primary === '-' ? 'neutral' : 'success'}
          title="Ports"
        />
        <MapNode
          className="port-node port-node-right"
          detail={runtimeDetail}
          meta={runtimeTitle}
          tone={runtimeTone}
          title="Runtime"
        />
        <Section className={`hub-node hub-${project.runtime.status} hub-${actionState?.phase ?? 'idle'}`} padding={2} variant="transparent">
          <VStack align="center" gap={1}>
            <Box size={24} />
            <VStack align="center" gap={0}>
              <Heading level={1} maxLines={1}>{project.displayName}</Heading>
              <Text color="secondary" maxLines={1} type="supporting">{project.kind}</Text>
            </VStack>
            <HStack align="center" gap={1} wrap="wrap">
              <ProjectStatusBadge status={project.status} />
              <Badge label={project.runtime.status} variant={project.runtime.status === 'running' ? 'success' : 'neutral'} />
              {actionState?.actionId ? <Badge label={actionState.title} variant={runtimeActionBadgeVariant(actionState)} /> : null}
              {project.runtime.ownedProcesses[0]?.pid ? (
                <Text color="secondary" hasTabularNumbers type="supporting">
                  pid {project.runtime.ownedProcesses[0].pid}
                </Text>
              ) : null}
            </HStack>
          </VStack>
        </Section>
      </Section>
    </Section>
  )
}

function MapNode({
  className,
  title,
  detail,
  meta,
  tone,
}: {
  className: string
  title: string
  detail: string
  meta: string
  tone: ProjectEvent['tone']
}) {
  return (
    <Section className={`map-node ${className} tone-${tone}`} padding={1.5} variant="transparent">
      <VStack gap={0.5}>
        <Text color="secondary" maxLines={1} type="supporting">{title}</Text>
        <Text hasTabularNumbers maxLines={1} weight="semibold">{detail}</Text>
        <HStack align="center" gap={1}>
          <AstryxStatusDot label={`${title} ${meta}`} variant={eventDotVariant(tone)} />
          <Text color="secondary" hasTabularNumbers maxLines={1} type="supporting">{meta}</Text>
        </HStack>
      </VStack>
    </Section>
  )
}
