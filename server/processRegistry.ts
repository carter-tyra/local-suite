import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type {
  PackageSummary,
  ProjectConfig,
  ProjectRuntimeHistoryEntry,
  ProjectRuntimeProcess,
  RunTarget,
} from '../src/shared/types.ts'

export type ProcessRegistryStatus = 'starting' | 'running' | 'exited' | 'failed' | 'stale'
export type ProcessRegistryStopResult = 'sent' | 'failed'

const processRegistryStatusSchema = z.enum(['starting', 'running', 'exited', 'failed', 'stale'])
const processRegistryStopResultSchema = z.enum(['sent', 'failed'])

const processRegistryEntrySchema = z.object({
  childPid: z.number().int().positive().nullable(),
  commandLabel: z.string().min(1),
  entryId: z.string().min(1),
  exitCode: z.number().int().nullable(),
  exitedAt: z.string().nullable(),
  manager: z.enum(['pnpm', 'npm', 'yarn', 'bun', 'unknown']),
  projectId: z.string().min(1),
  projectPath: z.string().min(1),
  runnerPid: z.number().int().positive().nullable(),
  script: z.string().min(1),
  signal: z.string().nullable(),
  startedAt: z.string(),
  status: processRegistryStatusSchema,
  stopExitCode: z.number().int().nullable().default(null),
  stopRequestedAt: z.string().nullable().default(null),
  stopRequestedBy: z.literal('local-suite').nullable().default(null),
  stopResult: processRegistryStopResultSchema.nullable().default(null),
  stopSignal: z.string().nullable().default(null),
  targetId: z.string().min(1),
  updatedAt: z.string(),
})

const processRegistryFileSchema = z.object({
  entries: z.array(processRegistryEntrySchema),
  version: z.literal(1),
})

export type ProcessRegistryEntry = z.infer<typeof processRegistryEntrySchema>

export interface ProcessRegistryFile {
  entries: ProcessRegistryEntry[]
  version: 1
}

export interface ProcessRegistrySnapshot {
  activeEntries: ProcessRegistryEntry[]
  entries: ProcessRegistryEntry[]
}

export interface ProcessRegistryOptions {
  isProcessAlive?: (pid: number) => boolean
  now?: () => Date
  registryPath?: string
}

export interface CreateProcessRegistryEntryInput {
  project: ProjectConfig
  target: RunTarget
}

export interface MarkProcessRegistryStopRequestedInput {
  exitCode: number
  requestedBy?: 'local-suite'
  result?: ProcessRegistryStopResult
  signal: string
}

const STARTING_WITHOUT_PID_STALE_MS = 30_000

export function defaultProcessRegistryPath(): string {
  return process.env.LOCAL_SUITE_PROCESS_REGISTRY
    ?? path.join(os.homedir(), 'Library', 'Application Support', 'Local Suite', 'process-registry.json')
}

export async function readProcessRegistry(registryPath = defaultProcessRegistryPath()): Promise<ProcessRegistryFile> {
  try {
    const raw = await fs.readFile(registryPath, 'utf8')
    return processRegistryFileSchema.parse(JSON.parse(raw))
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { entries: [], version: 1 }
    }
    if (error instanceof z.ZodError) {
      throw new Error(`Process registry is invalid: ${error.message}`)
    }
    throw error
  }
}

export async function createProcessRegistryEntry(
  input: CreateProcessRegistryEntryInput,
  options: ProcessRegistryOptions = {},
): Promise<ProcessRegistryEntry> {
  const now = (options.now ?? (() => new Date()))().toISOString()
  const entry: ProcessRegistryEntry = {
    childPid: null,
    commandLabel: input.target.commandLabel,
    entryId: randomUUID(),
    exitCode: null,
    exitedAt: null,
    manager: input.target.manager,
    projectId: input.project.id,
    projectPath: input.project.path,
    runnerPid: null,
    script: input.target.script,
    signal: null,
    startedAt: now,
    status: 'starting',
    stopExitCode: null,
    stopRequestedAt: null,
    stopRequestedBy: null,
    stopResult: null,
    stopSignal: null,
    targetId: input.target.id,
    updatedAt: now,
  }

  await upsertProcessRegistryEntry(entry, options.registryPath)
  return entry
}

export async function markProcessRegistryRunning(
  entryId: string,
  input: { childPid: number | null; runnerPid: number },
  options: ProcessRegistryOptions = {},
): Promise<void> {
  await updateProcessRegistryEntry(entryId, options, (entry, now) => ({
    ...entry,
    childPid: input.childPid,
    runnerPid: input.runnerPid,
    status: 'running',
    updatedAt: now,
  }))
}

export async function markProcessRegistryExited(
  entryId: string,
  input: { exitCode: number | null; signal: string | null; status?: Extract<ProcessRegistryStatus, 'exited' | 'failed' | 'stale'> },
  options: ProcessRegistryOptions = {},
): Promise<void> {
  await updateProcessRegistryEntry(entryId, options, (entry, now) => ({
    ...entry,
    exitCode: input.exitCode,
    exitedAt: now,
    signal: input.signal,
    status: input.status ?? (input.exitCode === 0 ? 'exited' : 'failed'),
    updatedAt: now,
  }))
}

export async function markProcessRegistryStopRequested(
  entryIds: string[],
  input: MarkProcessRegistryStopRequestedInput,
  options: ProcessRegistryOptions = {},
): Promise<number> {
  if (!entryIds.length) return 0

  const registryPath = options.registryPath ?? defaultProcessRegistryPath()
  const registry = await readProcessRegistry(registryPath)
  const now = (options.now ?? (() => new Date()))().toISOString()
  const ids = new Set(entryIds)
  let updatedCount = 0
  const entries = registry.entries.map((entry) => {
    if (!ids.has(entry.entryId)) return entry
    updatedCount += 1
    return {
      ...entry,
      stopExitCode: input.exitCode,
      stopRequestedAt: now,
      stopRequestedBy: input.requestedBy ?? 'local-suite',
      stopResult: input.result ?? (input.exitCode === 0 ? 'sent' : 'failed'),
      stopSignal: input.signal,
      updatedAt: now,
    }
  })

  if (updatedCount > 0) {
    await writeProcessRegistry({ entries, version: 1 }, registryPath)
  }

  return updatedCount
}

export async function readActiveProcessRegistryEntries(
  options: ProcessRegistryOptions = {},
): Promise<ProcessRegistryEntry[]> {
  return (await readProcessRegistrySnapshot(options)).activeEntries
}

export async function readProcessRegistrySnapshot(
  options: ProcessRegistryOptions = {},
): Promise<ProcessRegistrySnapshot> {
  const reconciled = await reconcileProcessRegistry(options)
  const isAlive = options.isProcessAlive ?? processIsAlive
  return {
    activeEntries: reconciled.entries.filter((entry) => isActiveRegistryEntry(entry, isAlive)),
    entries: reconciled.entries,
  }
}

export function registryRuntimeProcessesForProject(
  project: Pick<ProjectConfig, 'id' | 'path'>,
  entries: ProcessRegistryEntry[],
  isProcessAlive: (pid: number) => boolean = processIsAlive,
): ProjectRuntimeProcess[] {
  return entries
    .filter((entry) => isRegistryEntryForProject(project, entry))
    .flatMap((entry): ProjectRuntimeProcess[] => {
      const childPid = entry.childPid && isProcessAlive(entry.childPid) ? entry.childPid : null
      const runnerPid = entry.runnerPid && isProcessAlive(entry.runnerPid) ? entry.runnerPid : null
      const pid = childPid ?? runnerPid

      if (!pid) return []

      return [{
        bindIp: null,
        command: entry.commandLabel,
        pid,
        port: null,
        processGroupPid: childPid ?? undefined,
        registryId: entry.entryId,
        scope: 'local',
        source: 'registry',
        startedAt: entry.startedAt,
        targetId: entry.targetId,
      }]
    })
}

export function registryHistoryForProject(
  project: Pick<ProjectConfig, 'id' | 'path'>,
  entries: ProcessRegistryEntry[],
  limit = 5,
): ProjectRuntimeHistoryEntry[] {
  return entries
    .filter((entry) => isRegistryEntryForProject(project, entry))
    .sort((left, right) => compareRegistryEntryRecency(left, right))
    .slice(0, limit)
    .map((entry) => ({
      childPid: entry.childPid,
      commandLabel: entry.commandLabel,
      entryId: entry.entryId,
      exitCode: entry.exitCode,
      exitedAt: entry.exitedAt,
      runnerPid: entry.runnerPid,
      script: entry.script,
      signal: entry.signal,
      startedAt: entry.startedAt,
      status: entry.status,
      stopExitCode: entry.stopExitCode,
      stopRequestedAt: entry.stopRequestedAt,
      stopRequestedBy: entry.stopRequestedBy,
      stopResult: entry.stopResult,
      stopSignal: entry.stopSignal,
      targetId: entry.targetId,
      updatedAt: entry.updatedAt,
    }))
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === 'ESRCH') return false
    if (isNodeError(error) && error.code === 'EPERM') return true
    return false
  }
}

async function reconcileProcessRegistry(options: ProcessRegistryOptions = {}): Promise<ProcessRegistryFile> {
  const registryPath = options.registryPath ?? defaultProcessRegistryPath()
  const nowDate = options.now ?? (() => new Date())
  const isAlive = options.isProcessAlive ?? processIsAlive
  const registry = await readProcessRegistry(registryPath)
  let changed = false
  const now = nowDate()
  const entries = registry.entries.map((entry) => {
    if (!isStartingOrRunning(entry.status)) return entry
    if (isActiveRegistryEntry(entry, isAlive)) return entry

    const ageMs = now.getTime() - new Date(entry.updatedAt).getTime()
    const staleWithoutPid = entry.status === 'starting' && !entry.runnerPid && !entry.childPid && ageMs >= STARTING_WITHOUT_PID_STALE_MS
    const staleWithDeadPid = Boolean(entry.runnerPid || entry.childPid)
    if (!staleWithoutPid && !staleWithDeadPid) return entry

    changed = true
    return {
      ...entry,
      exitedAt: entry.exitedAt ?? now.toISOString(),
      status: 'stale' as const,
      updatedAt: now.toISOString(),
    }
  })

  const reconciled = { entries, version: 1 as const }
  if (changed) await writeProcessRegistry(reconciled, registryPath)
  return reconciled
}

async function upsertProcessRegistryEntry(entry: ProcessRegistryEntry, registryPath = defaultProcessRegistryPath()): Promise<void> {
  const registry = await readProcessRegistry(registryPath)
  const nextEntries = registry.entries.filter((current) => current.entryId !== entry.entryId)
  nextEntries.push(entry)
  await writeProcessRegistry({ entries: nextEntries, version: 1 }, registryPath)
}

async function updateProcessRegistryEntry(
  entryId: string,
  options: ProcessRegistryOptions,
  update: (entry: ProcessRegistryEntry, now: string) => ProcessRegistryEntry,
): Promise<void> {
  const registryPath = options.registryPath ?? defaultProcessRegistryPath()
  const registry = await readProcessRegistry(registryPath)
  const now = (options.now ?? (() => new Date()))().toISOString()
  let found = false
  const entries = registry.entries.map((entry) => {
    if (entry.entryId !== entryId) return entry
    found = true
    return update(entry, now)
  })

  if (!found) {
    throw new Error(`Process registry entry not found: ${entryId}`)
  }

  await writeProcessRegistry({ entries, version: 1 }, registryPath)
}

async function writeProcessRegistry(registry: ProcessRegistryFile, registryPath: string): Promise<void> {
  await fs.mkdir(path.dirname(registryPath), { recursive: true })
  const tempPath = `${registryPath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 })
  await fs.rename(tempPath, registryPath)
}

function isActiveRegistryEntry(entry: ProcessRegistryEntry, isProcessAlive: (pid: number) => boolean): boolean {
  if (!isStartingOrRunning(entry.status)) return false
  return Boolean(
    (entry.childPid && isProcessAlive(entry.childPid))
    || (entry.runnerPid && isProcessAlive(entry.runnerPid)),
  )
}

function isRegistryEntryForProject(project: Pick<ProjectConfig, 'id' | 'path'>, entry: ProcessRegistryEntry): boolean {
  return entry.projectId === project.id && path.resolve(entry.projectPath) === path.resolve(project.path)
}

function compareRegistryEntryRecency(left: ProcessRegistryEntry, right: ProcessRegistryEntry): number {
  const updatedDiff = timestampFor(right.updatedAt) - timestampFor(left.updatedAt)
  if (updatedDiff !== 0) return updatedDiff
  return timestampFor(right.startedAt) - timestampFor(left.startedAt)
}

function timestampFor(value: string): number {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function isStartingOrRunning(status: ProcessRegistryStatus): boolean {
  return status === 'starting' || status === 'running'
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

export function assertPackageManager(value: string): PackageSummary['manager'] {
  if (value === 'pnpm' || value === 'npm' || value === 'yarn' || value === 'bun' || value === 'unknown') return value
  throw new Error(`Unsupported package manager: ${value}`)
}
