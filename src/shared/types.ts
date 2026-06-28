export type Priority = 'active' | 'watch' | 'archive'

export type ProjectStatus = 'ready' | 'attention' | 'idle' | 'unknown'

export type ActionKind = 'read' | 'preview' | 'blocked'

export interface ProjectConfig {
  id: string
  displayName: string
  path: string
  kind: string
  priority: Priority
  tags: string[]
  devctlProject?: string
  composeProject?: string
}

export interface GitSummary {
  isRepo: boolean
  branch: string | null
  dirtyCount: number
  stagedCount: number
  untrackedCount: number
  lastCommit: string | null
  status: 'clean' | 'dirty' | 'not-repo' | 'error'
}

export interface PackageSummary {
  packageName: string | null
  manager: 'pnpm' | 'npm' | 'yarn' | 'bun' | 'unknown'
  hasWorkspace: boolean
  scripts: string[]
}

export interface DockerPort {
  hostIp: string
  hostPort: string
  target: string
  public: boolean
  container?: string
}

export interface DockerContainerSummary {
  id: string
  name: string
  service: string
  image: string
  running: boolean
  status: string
  health: string
  cpu: number
  memMib: number
  memUsage: string
  workingDir: string
  ports: DockerPort[]
}

export interface DockerProjectSummary {
  composeProject: string
  registered: boolean
  safeToStop: boolean
  heavy: boolean
  running: number
  cpu: number
  memMib: number
  ports: DockerPort[]
  publicPorts: DockerPort[]
  containers: DockerContainerSummary[]
}

export interface ListenerPort {
  command: string
  pid: number | null
  bindIp: string
  port: string
  scope: 'local' | 'public' | 'unknown'
}

export interface SafeAction {
  id: 'devctl-up-preview' | 'devctl-down-preview' | 'docker-doctor' | 'stop-candidates'
  label: string
  kind: ActionKind
  disabled: boolean
  reason: string
}

export interface ProjectSummary {
  id: string
  displayName: string
  path: string
  kind: string
  priority: Priority
  tags: string[]
  source: 'configured' | 'discovered'
  exists: boolean
  status: ProjectStatus
  signals: string[]
  git: GitSummary
  package: PackageSummary | null
  docker: DockerProjectSummary | null
  actions: SafeAction[]
}

export interface DockerFleetSummary {
  dockerAvailable: boolean
  runningContainers: number
  totalContainers: number
  cpu: number
  memMib: number
  memoryLimitMib: number | null
  publicPortCount: number
  registryProjectCount: number
  disk: string[]
  publicPortsMessage: string
}

export interface SnapshotSummary {
  configuredProjects: number
  discoveredProjects: number
  activeProjects: number
  attentionProjects: number
  dirtyRepos: number
  packageProjects: number
}

export interface LocalSuiteSnapshot {
  generatedAt: string
  roots: string[]
  summary: SnapshotSummary
  docker: DockerFleetSummary
  projects: ProjectSummary[]
  listeners: ListenerPort[]
  warnings: string[]
}

export interface ActionResult {
  actionId: SafeAction['id']
  projectId: string | null
  command: string
  exitCode: number
  stdout: string
  stderr: string
  redacted: boolean
  generatedAt: string
}
