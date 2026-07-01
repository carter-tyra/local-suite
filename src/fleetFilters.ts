import type { ProjectStatus, ProjectSummary } from './shared/types.ts'

export type FleetStatusFilter = 'all' | ProjectStatus
export type FleetKindFilter = 'all' | string

export interface FleetKindFilterOption {
  value: FleetKindFilter
  label: string
  count: number
}

export const FLEET_STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'attention', label: 'Needs' },
  { value: 'ready', label: 'Ready' },
  { value: 'idle', label: 'Idle' },
  { value: 'unknown', label: 'Unknown' },
] as const satisfies readonly { value: FleetStatusFilter; label: string }[]

const FLEET_STATUS_FILTER_VALUES = new Set<FleetStatusFilter>(
  FLEET_STATUS_FILTERS.map((filter) => filter.value),
)

export interface FleetProjectFilter {
  kind: FleetKindFilter
  query: string
  status: FleetStatusFilter
}

export function toFleetStatusFilter(value: string): FleetStatusFilter {
  return FLEET_STATUS_FILTER_VALUES.has(value as FleetStatusFilter) ? (value as FleetStatusFilter) : 'all'
}

export function toFleetKindFilter(value: string | null, projects: ProjectSummary[]): FleetKindFilter {
  if (!value || value === 'all') return 'all'

  return projects.some((project) => project.kind === value) ? value : 'all'
}

export function filterProjects(projects: ProjectSummary[], filter: FleetProjectFilter): ProjectSummary[] {
  const terms = normalize(filter.query).split(' ').filter(Boolean)

  return projects.filter((project) => {
    if (filter.status !== 'all' && project.status !== filter.status) return false
    if (filter.kind !== 'all' && project.kind !== filter.kind) return false
    if (!terms.length) return true

    const searchText = projectSearchText(project)
    return terms.every((term) => searchText.includes(term))
  })
}

export function getProjectKindFilters(projects: ProjectSummary[]): FleetKindFilterOption[] {
  const counts = new Map<string, number>()

  for (const project of projects) {
    counts.set(project.kind, (counts.get(project.kind) ?? 0) + 1)
  }

  const kindFilters = Array.from(counts, ([value, count]) => ({
    count,
    label: value,
    value,
  })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))

  return [{ count: projects.length, label: 'All kinds', value: 'all' }, ...kindFilters]
}

export function countProjectsByStatus(projects: ProjectSummary[]): Record<FleetStatusFilter, number> {
  const counts: Record<FleetStatusFilter, number> = {
    all: projects.length,
    attention: 0,
    idle: 0,
    ready: 0,
    unknown: 0,
  }

  for (const project of projects) {
    counts[project.status] += 1
  }

  return counts
}

function projectSearchText(project: ProjectSummary): string {
  return normalize(
    [
      project.displayName,
      project.id,
      project.kind,
      project.path,
      project.priority,
      project.source,
      project.status,
      ...project.tags,
      ...project.signals,
      project.git.branch,
      project.git.lastCommit,
      project.git.status,
      project.package?.packageName,
      project.package?.manager,
      ...(project.package?.scripts ?? []),
      project.docker?.composeProject,
      ...(project.docker?.ports.map((port) => `${port.hostIp} ${port.hostPort} ${port.target}`) ?? []),
      ...(project.docker?.containers.map((container) => `${container.name} ${container.service} ${container.image}`) ??
        []),
    ]
      .filter(Boolean)
      .join(' '),
  )
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}
