import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Selector } from '@astryxdesign/core/Selector'
import { Section } from '@astryxdesign/core/Section'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Toolbar } from '@astryxdesign/core/Toolbar'
import { VStack } from '@astryxdesign/core/VStack'
import { Search } from '@carbon/icons-react'
import { plural } from '../../format.ts'
import {
  FLEET_STATUS_FILTERS,
  countProjectsByStatus,
  toFleetKindFilter,
  toFleetStatusFilter,
  type FleetKindFilter,
  type FleetKindFilterOption,
  type FleetStatusFilter,
} from '../../fleetFilters.ts'
import type { ProjectSummary } from '../../shared/types.ts'
import { projectPrimaryCommand } from './model.ts'
import { ProjectStatusDot } from './shared.tsx'
import { MAX_RAIL_PROJECTS, type WorkbenchDialog } from './types.ts'

export function ProjectRail({
  projects,
  totalProjects,
  kindFilters,
  query,
  filterKind,
  filterStatus,
  selectedId,
  onFilterKindChange,
  onQueryChange,
  onFilterStatusChange,
  onResetFilters,
  onSelect,
  onDialogOpen,
}: {
  projects: ProjectSummary[]
  totalProjects: ProjectSummary[]
  kindFilters: FleetKindFilterOption[]
  query: string
  filterKind: FleetKindFilter
  filterStatus: FleetStatusFilter
  selectedId: string | null
  onFilterKindChange: (kind: FleetKindFilter) => void
  onQueryChange: (query: string) => void
  onFilterStatusChange: (status: FleetStatusFilter) => void
  onResetFilters: () => void
  onSelect: (id: string) => void
  onDialogOpen: (dialog: WorkbenchDialog) => void
}) {
  const statusCounts = countProjectsByStatus(totalProjects)
  const visibleProjects = projects.slice(0, MAX_RAIL_PROJECTS)
  const filtersActive = query.trim().length > 0 || filterKind !== 'all' || filterStatus !== 'all'

  return (
    <Section aria-label="Projects" className="project-rail" padding={0} variant="transparent">
      <Toolbar
        endContent={
          <Button label="All" onClick={() => onDialogOpen('fleet')} size="sm" variant="ghost" />
        }
        label="Projects"
        size="sm"
        startContent={<Heading level={2}>Projects</Heading>}
        variant="transparent"
      />
      <Section className="rail-filters" padding={1.5} variant="transparent">
        <VStack gap={1.5}>
          <TextInput
            hasClear
            isLabelHidden
            label="Filter projects"
            onChange={onQueryChange}
            placeholder="Filter projects"
            size="sm"
            startIcon={<Search size={16} />}
            value={query}
          />
          <SegmentedControl
            className="status-tabs"
            label="Project status"
            onChange={(value) => onFilterStatusChange(toFleetStatusFilter(value))}
            size="sm"
            value={filterStatus}
          >
            {FLEET_STATUS_FILTERS.slice(0, 4).map((filter) => (
              <SegmentedControlItem
                key={filter.value}
                label={`${filter.label} ${statusCounts[filter.value]}`}
                value={filter.value}
              />
            ))}
          </SegmentedControl>
          <HStack align="center" gap={1}>
            <Selector
              hasSearch
              isLabelHidden
              label="Project kind"
              onChange={(value) => onFilterKindChange(toFleetKindFilter(value, totalProjects))}
              options={kindFilters.map((filter) => ({
                label: `${filter.label} ${filter.count}`,
                value: filter.value,
              }))}
              placeholder="Kind"
              searchPlaceholder="Search kinds"
              size="sm"
              value={filterKind}
            />
            {filtersActive ? <Button label="Reset" onClick={onResetFilters} size="sm" variant="ghost" /> : null}
          </HStack>
        </VStack>
      </Section>
      <VStack className="project-list" gap={0.5}>
        {visibleProjects.map((project) => (
          <Button
            className={`project-row ${project.id === selectedId ? 'is-selected' : ''}`}
            key={project.id}
            label={`Select ${project.displayName}`}
            onClick={() => onSelect(project.id)}
            size="sm"
            variant="ghost"
          >
            <HStack align="center" gap={1.5} width="100%">
              <ProjectStatusDot status={project.status} />
              <VStack className="project-row-copy" gap={0}>
                <Text maxLines={1} weight="semibold">{project.displayName}</Text>
                <Text color="secondary" maxLines={1} type="supporting">
                  {project.kind} / {projectPrimaryCommand(project)}
                </Text>
              </VStack>
              <ProjectMiniSignal project={project} />
            </HStack>
          </Button>
        ))}
      </VStack>
      <Section className="rail-footer" padding={1.5} variant="transparent">
        <Button
          label={projects.length > visibleProjects.length ? `View ${projects.length} projects` : plural(totalProjects.length, 'project')}
          onClick={() => onDialogOpen('fleet')}
          size="sm"
          variant="secondary"
        />
      </Section>
    </Section>
  )
}

function ProjectMiniSignal({ project }: { project: ProjectSummary }) {
  if (project.runtime.status === 'running') return <Badge label="run" variant="success" />
  if (project.git.dirtyCount) return <Badge label={String(project.git.dirtyCount)} variant="warning" />
  if (project.docker?.running) return <Badge label="dock" variant="blue" />
  return <Text color="secondary" type="supporting">-</Text>
}
