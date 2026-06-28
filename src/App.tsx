import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Code2,
  Container,
  GitBranch,
  Globe2,
  Loader2,
  Play,
  RefreshCcw,
  ShieldCheck,
  SquareTerminal,
} from 'lucide-react'
import { fetchSnapshot, runAction } from './api.ts'
import './App.css'
import { formatMib, formatPercent, formatTime, plural } from './format.ts'
import type { ActionResult, LocalSuiteSnapshot, ProjectSummary, SafeAction } from './shared/types.ts'

function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [actionResult, setActionResult] = useState<ActionResult | null>(null)
  const queryClient = useQueryClient()
  const snapshotQuery = useQuery({
    queryKey: ['snapshot'],
    queryFn: fetchSnapshot,
    refetchInterval: 15_000,
  })
  const actionMutation = useMutation({
    mutationFn: runAction,
    onSuccess: (result) => {
      setActionResult(result)
      void queryClient.invalidateQueries({ queryKey: ['snapshot'] })
    },
  })

  const snapshot = snapshotQuery.data
  const selectedProject = useMemo(() => {
    if (!snapshot?.projects.length) return null
    return snapshot.projects.find((project) => project.id === selectedId) ?? snapshot.projects[0] ?? null
  }, [selectedId, snapshot])

  const handleAction = (actionId: SafeAction['id'], projectId?: string) => {
    actionMutation.mutate({ actionId, projectId })
  }

  const actionError = actionMutation.error instanceof Error ? actionMutation.error.message : null

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Local Suite navigation">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <Boxes size={18} />
          </div>
          <div>
            <strong>Local Suite</strong>
            <span>v1 control plane</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="Views">
          <a className="nav-item active" href="#fleet">
            <Container size={16} />
            Fleet
          </a>
          <a className="nav-item" href="#ports">
            <Globe2 size={16} />
            Ports
          </a>
          <a className="nav-item" href="#actions">
            <SquareTerminal size={16} />
            Actions
          </a>
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={16} />
          <span>No env files read.</span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Developer fleet</p>
            <h1>Local control plane</h1>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => void snapshotQuery.refetch()}
            disabled={snapshotQuery.isFetching}
            aria-label="Refresh snapshot"
            title="Refresh snapshot"
          >
            {snapshotQuery.isFetching ? <Loader2 size={17} className="spin" /> : <RefreshCcw size={17} />}
          </button>
        </header>

        {snapshotQuery.isPending ? (
          <LoadingState />
        ) : snapshotQuery.isError ? (
          <ErrorState message={snapshotQuery.error.message} />
        ) : snapshot ? (
          <>
            <StatusStrip snapshot={snapshot} />
            <section className="content-grid" id="fleet">
              <FleetTable
                projects={snapshot.projects}
                selectedId={selectedProject?.id ?? null}
                onSelect={setSelectedId}
              />
              <ProjectDetail
                project={selectedProject}
                actionResult={actionResult}
                actionPending={actionMutation.isPending}
                actionError={actionError}
                onAction={handleAction}
              />
            </section>
            <PortPanel snapshot={snapshot} />
          </>
        ) : null}
      </main>
    </div>
  )
}

function LoadingState() {
  return (
    <section className="state-panel" aria-live="polite">
      <Loader2 size={18} className="spin" />
      <span>Loading local state</span>
    </section>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <section className="state-panel error" role="alert">
      <AlertTriangle size={18} />
      <span>{message}</span>
    </section>
  )
}

function StatusStrip({ snapshot }: { snapshot: LocalSuiteSnapshot }) {
  const memoryLimit = snapshot.docker.memoryLimitMib ? formatMib(snapshot.docker.memoryLimitMib) : '-'
  const cells = [
    {
      label: 'Docker',
      value: `${snapshot.docker.runningContainers}/${snapshot.docker.totalContainers}`,
      detail: 'containers',
      icon: <Container size={16} />,
    },
    {
      label: 'Memory',
      value: formatMib(snapshot.docker.memMib),
      detail: memoryLimit,
      icon: <Activity size={16} />,
    },
    {
      label: 'Public Docker ports',
      value: String(snapshot.docker.publicPortCount),
      detail: snapshot.docker.publicPortsMessage,
      icon: <Globe2 size={16} />,
    },
    {
      label: 'Needs attention',
      value: String(snapshot.summary.attentionProjects),
      detail: plural(snapshot.summary.dirtyRepos, 'dirty repo'),
      icon: <AlertTriangle size={16} />,
    },
  ]

  return (
    <section className="status-strip" aria-label="Fleet status">
      {cells.map((cell) => (
        <div className="metric" key={cell.label}>
          <div className="metric-icon">{cell.icon}</div>
          <div>
            <span>{cell.label}</span>
            <strong>{cell.value}</strong>
            <small>{cell.detail}</small>
          </div>
        </div>
      ))}
      <div className="scan-time">
        <span>Updated</span>
        <strong>{formatTime(snapshot.generatedAt)}</strong>
      </div>
    </section>
  )
}

function FleetTable({
  projects,
  selectedId,
  onSelect,
}: {
  projects: ProjectSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <section className="fleet-panel" aria-labelledby="fleet-title">
      <div className="panel-heading">
        <div>
          <h2 id="fleet-title">Projects</h2>
          <p>{plural(projects.length, 'project')}</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Status</th>
              <th>Docker</th>
              <th>Git</th>
              <th>Package</th>
              <th>Ports</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                selected={project.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ProjectRow({
  project,
  selected,
  onSelect,
}: {
  project: ProjectSummary
  selected: boolean
  onSelect: (id: string) => void
}) {
  const dockerText = project.docker
    ? `${project.docker.running} run · ${formatMib(project.docker.memMib)}`
    : 'none'
  const portText = project.docker?.ports.length
    ? project.docker.ports.map((port) => `${port.hostIp}:${port.hostPort}`).slice(0, 2).join(', ')
    : '-'

  return (
    <tr className={selected ? 'selected' : ''}>
      <td>
        <button className="project-select" type="button" onClick={() => onSelect(project.id)}>
          <StatusDot status={project.status} />
          <span>
            <strong>{project.displayName}</strong>
            <small>{project.kind}</small>
          </span>
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </td>
      <td>
        <span className={`status-pill ${project.status}`}>{project.status}</span>
      </td>
      <td className="numeric">{dockerText}</td>
      <td>
        {project.git.isRepo ? (
          <span className="inline-meta">
            <GitBranch size={14} />
            {project.git.branch ?? 'detached'}
            {project.git.dirtyCount ? ` · ${project.git.dirtyCount}` : ''}
          </span>
        ) : (
          '-'
        )}
      </td>
      <td>{project.package ? `${project.package.manager} · ${project.package.scripts.length}` : '-'}</td>
      <td className="ports-cell">{portText}</td>
    </tr>
  )
}

function ProjectDetail({
  project,
  actionResult,
  actionPending,
  actionError,
  onAction,
}: {
  project: ProjectSummary | null
  actionResult: ActionResult | null
  actionPending: boolean
  actionError: string | null
  onAction: (actionId: SafeAction['id'], projectId?: string) => void
}) {
  if (!project) {
    return (
      <aside className="detail-panel">
        <div className="empty-detail">No project selected</div>
      </aside>
    )
  }

  return (
    <aside className="detail-panel" aria-label="Project detail">
      <div className="detail-header">
        <div>
          <p className="eyebrow">Selected project</p>
          <h2>{project.displayName}</h2>
        </div>
        <StatusDot status={project.status} />
      </div>

      <dl className="detail-list">
        <div>
          <dt>Path</dt>
          <dd>{project.path}</dd>
        </div>
        <div>
          <dt>Git</dt>
          <dd>{project.git.isRepo ? `${project.git.branch ?? 'detached'} · ${project.git.status}` : 'Not a repo'}</dd>
        </div>
        <div>
          <dt>Docker</dt>
          <dd>{project.docker ? `${project.docker.running} running · ${formatPercent(project.docker.cpu)}` : 'No stack'}</dd>
        </div>
        <div>
          <dt>Scripts</dt>
          <dd>{project.package?.scripts.slice(0, 8).join(', ') || 'None'}</dd>
        </div>
      </dl>

      <div className="signal-list" aria-label="Signals">
        {project.signals.map((signal) => (
          <span key={signal}>{signal}</span>
        ))}
      </div>

      <section className="action-block" id="actions">
        <div className="panel-heading compact">
          <div>
            <h3>Actions</h3>
            <p>Safe by default</p>
          </div>
        </div>
        <div className="action-grid">
          {project.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="action-button"
              disabled={action.disabled || actionPending}
              onClick={() => onAction(action.id, project.id)}
              title={action.reason}
            >
              {actionPending ? <Loader2 size={15} className="spin" /> : action.kind === 'read' ? <Code2 size={15} /> : <Play size={15} />}
              <span>{action.label}</span>
              <small>{action.reason}</small>
            </button>
          ))}
        </div>
        <button className="blocked-button" type="button" disabled>
          <AlertTriangle size={15} />
          Execute requires approval
        </button>
      </section>

      {actionError ? <p className="action-error" role="alert">{actionError}</p> : null}
      {actionResult ? <ActionOutput result={actionResult} /> : null}
    </aside>
  )
}

function ActionOutput({ result }: { result: ActionResult }) {
  return (
    <section className="action-output" aria-label="Action output">
      <div>
        <span>Command</span>
        <code>{result.command}</code>
      </div>
      <pre>{result.stdout || result.stderr || 'No output'}</pre>
      {result.redacted ? <small>Secret-like values were redacted.</small> : null}
    </section>
  )
}

function PortPanel({ snapshot }: { snapshot: LocalSuiteSnapshot }) {
  const publicListeners = snapshot.listeners.filter((listener) => listener.scope === 'public')
  return (
    <section className="port-panel" id="ports" aria-labelledby="ports-title">
      <div className="panel-heading">
        <div>
          <h2 id="ports-title">Ports</h2>
          <p>Docker public exposure: {snapshot.docker.publicPortCount}</p>
        </div>
        <span className="status-pill ready">{plural(publicListeners.length, 'public listener')}</span>
      </div>
      <div className="listener-grid">
        {snapshot.listeners.slice(0, 12).map((listener, index) => (
          <div className="listener" key={`${listener.pid}-${listener.port}-${listener.command}-${listener.bindIp}-${index}`}>
            <span className={`scope-dot ${listener.scope}`} />
            <strong>{listener.port}</strong>
            <span>{listener.command}</span>
            <small>{listener.bindIp}</small>
          </div>
        ))}
      </div>
    </section>
  )
}

function StatusDot({ status }: { status: ProjectSummary['status'] }) {
  if (status === 'ready') return <CheckCircle2 className="status-dot ready" size={16} />
  if (status === 'attention') return <AlertTriangle className="status-dot attention" size={16} />
  if (status === 'idle') return <CircleDot className="status-dot idle" size={16} />
  return <CircleDot className="status-dot unknown" size={16} />
}

export default App
