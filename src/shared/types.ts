export type Priority = 'active' | 'watch' | 'archive'

export type ProjectStatus = 'ready' | 'attention' | 'idle' | 'unknown'

export type ActionKind = 'read' | 'preview' | 'terminal' | 'process' | 'blocked'

export const SAFE_ACTION_IDS = [
  'script-start',
  'script-stop',
  'devctl-up-preview',
  'devctl-down-preview',
  'docker-doctor',
  'stop-candidates',
] as const

export type SafeActionId = typeof SAFE_ACTION_IDS[number]

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

export interface RunTarget {
  commandLabel: string
  id: string
  label: string
  manager: PackageSummary['manager']
  primary: boolean
  script: string
}

export interface ProjectRuntimeProcess {
  bindIp: string | null
  command: string
  pid: number
  port: string | null
  processGroupPid?: number
  registryId?: string
  scope: ListenerPort['scope']
  source?: 'listener' | 'registry'
  startedAt?: string
  targetId?: string
}

export interface ProjectRuntimeHistoryEntry {
  childPid: number | null
  commandLabel: string
  entryId: string
  exitCode: number | null
  exitedAt: string | null
  runnerPid: number | null
  script: string
  signal: string | null
  startedAt: string
  status: 'starting' | 'running' | 'exited' | 'failed' | 'stale'
  stopExitCode: number | null
  stopRequestedAt: string | null
  stopRequestedBy: 'local-suite' | null
  stopResult: 'sent' | 'failed' | null
  stopSignal: string | null
  targetId: string
  updatedAt: string
}

export interface ProjectRuntimeSummary {
  history: ProjectRuntimeHistoryEntry[]
  ownedProcesses: ProjectRuntimeProcess[]
  primaryTarget: RunTarget | null
  status: 'running' | 'stopped'
  stopReason: string
  targets: RunTarget[]
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
  owner: 'local-suite' | 'external'
  projectId: string | null
  projectMatch: 'local-suite' | 'docker-port' | 'process-cwd' | null
  ruleKey: string
  classification: 'ignored' | null
  classificationReason: string | null
}

export interface IgnoredListenerRule {
  bindIp: string
  command: string
  createdAt: string
  key: string
  port: string
  reason: string
  scope: ListenerPort['scope']
}

export interface ListenerRulesFile {
  version: 1
  ignored: IgnoredListenerRule[]
}

export interface ListenerRulesSummary {
  ignoredCount: number
  ignored: IgnoredListenerRule[]
}

export interface ListenerRulePreview {
  action: 'ignore'
  alreadyIgnored: boolean
  generatedAt: string
  key: string
  matchingListeners: number
  reason: string
}

export interface ListenerRuleMutationResult extends ListenerRulePreview {
  applied: boolean
  ignoredCount: number
}

export interface SafeAction {
  id: SafeActionId
  label: string
  kind: ActionKind
  disabled: boolean
  reason: string
}

export interface ActionRequest {
  actionId: SafeActionId
  projectId?: string
  targetId?: string
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
  runtime: ProjectRuntimeSummary
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

export interface SnapshotTiming {
  totalMs: number
  phases: Record<string, number>
}

export interface DockerStateInfo {
  ageMs: number
  freshForMs: number
  generatedAt: string
  source: 'fresh' | 'cached'
}

export interface SnapshotCacheInfo {
  ageMs: number
  freshForMs: number
  generatedAt: string
  maxStaleMs: number
  state: 'miss' | 'fresh' | 'stale' | 'refreshing' | 'expired'
}

export interface SnapshotDiagnostics {
  cache: {
    ageMs: number | null
    freshForMs: number
    generatedAt: string | null
    hasSnapshot: boolean
    lastRefreshFailedAt: string | null
    maxStaleMs: number
    refreshInFlight: boolean
    state: SnapshotCacheInfo['state'] | 'empty'
  }
  snapshot: {
    counts: {
      attentionProjects: number
      dirtyRepos: number
      listeners: number
      projects: number
      publicDockerPorts: number
      runningContainers: number
      warnings: number
    }
    dockerState: DockerStateInfo
    generatedAt: string
    timing: SnapshotTiming
  } | null
}

export interface LocalSuiteSnapshot {
  generatedAt: string
  roots: string[]
  summary: SnapshotSummary
  docker: DockerFleetSummary
  projects: ProjectSummary[]
  listeners: ListenerPort[]
  listenerRules: ListenerRulesSummary
  dockerState: DockerStateInfo
  timing: SnapshotTiming
  cache?: SnapshotCacheInfo
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
