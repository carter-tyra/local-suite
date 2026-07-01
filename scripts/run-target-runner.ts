import { spawn } from 'node:child_process'
import {
  assertPackageManager,
  markProcessRegistryExited,
  markProcessRegistryRunning,
} from '../server/processRegistry.ts'
import {
  packageManagerExecutable,
  packageManagerRunArgs,
} from '../src/shared/runTargets.ts'

interface RunnerArgs {
  commandLabel: string
  entryId: string
  manager: ReturnType<typeof assertPackageManager>
  projectPath: string
  registryPath: string
  script: string
}

const args = parseArgs(process.argv.slice(2))
const executable = packageManagerExecutable(args.manager)
const child = spawn(executable, packageManagerRunArgs(args.manager, args.script), {
  cwd: args.projectPath,
  detached: true,
  env: process.env,
  stdio: 'inherit',
})

let finalized = false

await markProcessRegistryRunning(args.entryId, {
  childPid: child.pid ?? null,
  runnerPid: process.pid,
}, { registryPath: args.registryPath })

child.on('error', (error) => {
  void finalize({
    exitCode: 1,
    signal: null,
    status: 'failed',
  }).finally(() => {
    console.error(`Local Suite runner failed: ${error.message}`)
    process.exit(1)
  })
})

child.on('exit', (exitCode, signal) => {
  void finalize({
    exitCode,
    signal,
    status: exitCode === 0 ? 'exited' : 'failed',
  }).finally(() => {
    process.exit(exitCode ?? signalExitCode(signal))
  })
})

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (child.pid) {
    try {
      process.kill(-child.pid, signal)
    } catch (error) {
      if (!isMissingProcess(error)) throw error
    }
  }

  await finalize({
    exitCode: null,
    signal,
    status: 'failed',
  })
  process.exit(signalExitCode(signal))
}

async function finalize(input: {
  exitCode: number | null
  signal: NodeJS.Signals | null
  status: 'exited' | 'failed'
}): Promise<void> {
  if (finalized) return
  finalized = true
  await markProcessRegistryExited(args.entryId, {
    exitCode: input.exitCode,
    signal: input.signal,
    status: input.status,
  }, { registryPath: args.registryPath })
}

function parseArgs(rawArgs: string[]): RunnerArgs {
  const values = new Map<string, string>()
  for (let index = 0; index < rawArgs.length; index += 2) {
    const key = rawArgs[index]
    const value = rawArgs[index + 1]
    if (!key?.startsWith('--') || !value) {
      throw new Error(`Invalid runner argument near ${key ?? '<end>'}`)
    }
    values.set(key, value)
  }

  return {
    commandLabel: requireValue(values, '--command-label'),
    entryId: requireValue(values, '--entry-id'),
    manager: assertPackageManager(requireValue(values, '--manager')),
    projectPath: requireValue(values, '--project-path'),
    registryPath: requireValue(values, '--registry'),
    script: requireValue(values, '--script'),
  }
}

function requireValue(values: Map<string, string>, key: string): string {
  const value = values.get(key)
  if (!value) throw new Error(`Missing runner argument: ${key}`)
  return value
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  if (signal === 'SIGINT') return 130
  if (signal === 'SIGTERM') return 143
  return 1
}

function isMissingProcess(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ESRCH'
}

console.log(`Local Suite started ${args.commandLabel}`)
