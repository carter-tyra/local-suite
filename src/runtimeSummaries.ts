import type { ProjectRuntimeProcess, ProjectSummary } from './shared/types.ts'

const MAX_PORTS = 4
const MAX_COMMANDS = 3

export interface RunningProjectSummary {
  commandsLabel: string
  hasPublicPort: boolean
  portsLabel: string
  processCount: number
  projectId: string
  projectKind: string
  projectName: string
  scopeLabel: 'local' | 'mixed' | 'public' | 'unknown'
  trackedCount: number
}

export function summarizeRunningProjects(projects: ProjectSummary[]): RunningProjectSummary[] {
  return projects
    .map((project) => runningProjectSummary(project))
    .filter((summary): summary is RunningProjectSummary => summary !== null)
    .sort((left, right) => {
      if (left.hasPublicPort !== right.hasPublicPort) return left.hasPublicPort ? -1 : 1
      if (left.processCount !== right.processCount) return right.processCount - left.processCount
      return left.projectName.localeCompare(right.projectName)
    })
}

function runningProjectSummary(project: ProjectSummary): RunningProjectSummary | null {
  const processes = project.runtime.ownedProcesses
  const uniquePids = uniqueValues(processes.map((process) => String(process.pid)))

  if (!uniquePids.length) return null

  const ports = uniqueValues(processes.map((process) => process.port ?? '')).sort(sortPorts)
  const commands = uniqueValues(processes.map((process) => processCommandName(process)))
  const scopes = uniqueValues(processes.map((process) => process.scope))
  const hasPublicPort = scopes.includes('public')
  const trackedCount = uniqueValues(
    processes.filter((process) => process.source === 'registry').map((process) => String(process.pid)),
  ).length

  return {
    commandsLabel: formatLimited(commands, MAX_COMMANDS, 'process'),
    hasPublicPort,
    portsLabel: formatLimited(ports, MAX_PORTS, 'no ports'),
    processCount: uniquePids.length,
    projectId: project.id,
    projectKind: project.kind,
    projectName: project.displayName,
    scopeLabel: scopeLabel(processes),
    trackedCount,
  }
}

function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const value of values) {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    unique.push(normalized)
  }

  return unique
}

function processCommandName(process: ProjectRuntimeProcess): string {
  if (process.source === 'registry' && process.targetId?.startsWith('script:')) {
    return process.targetId.slice('script:'.length)
  }

  const executable = process.command.trim().split(/\s+/)[0] ?? ''
  const basename = executable.split('/').filter(Boolean).at(-1) ?? executable
  const sanitized = basename.replace(/[^A-Za-z0-9._:+-]/g, '').slice(0, 32)
  return sanitized || 'process'
}

function formatLimited(values: string[], max: number, emptyLabel: string): string {
  if (!values.length) return emptyLabel

  const visible = values.slice(0, max)
  const remaining = values.length - visible.length
  return remaining ? `${visible.join(', ')} +${remaining}` : visible.join(', ')
}

function sortPorts(left: string, right: string): number {
  const leftNumber = Number(left)
  const rightNumber = Number(right)

  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber
  return left.localeCompare(right)
}

function scopeLabel(processes: ProjectRuntimeProcess[]): RunningProjectSummary['scopeLabel'] {
  const scopes = new Set(processes.map((process) => process.scope))

  if (scopes.size === 1) return processes[0]?.scope ?? 'unknown'
  if (scopes.has('public')) return 'public'
  if (scopes.has('unknown')) return 'unknown'
  return 'mixed'
}
