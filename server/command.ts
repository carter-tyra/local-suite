import { spawn } from 'node:child_process'

export interface CommandResult {
  command: string
  args: string[]
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
  redacted: boolean
}

const SECRET_PATTERNS = [
  /([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|API[_-]?KEY|KEY)[A-Z0-9_]*\s*=\s*)[^\s"'`]+/gi,
  /(sk-[A-Za-z0-9_-]{12,})/g,
  /(ghp_[A-Za-z0-9_]{12,})/g,
  /(github_pat_[A-Za-z0-9_]{12,})/g,
  /(xox[baprs]-[A-Za-z0-9-]{12,})/g,
]

export function redactSecrets(input: string): { value: string; redacted: boolean } {
  let value = input
  let redacted = false

  for (const pattern of SECRET_PATTERNS) {
    value = value.replace(pattern, (match, prefix?: string) => {
      redacted = true
      return prefix && match.startsWith(prefix) ? `${prefix}[redacted]` : '[redacted]'
    })
  }

  return { value, redacted }
}

export function renderCommand(command: string, args: string[]): string {
  return [command, ...args]
    .map((part) => {
      if (/^[A-Za-z0-9_./:=@-]+$/.test(part)) return part
      return `'${part.replaceAll("'", "'\\''")}'`
    })
    .join(' ')
}

export async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; maxOutputChars?: number } = {},
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? 15_000
  const maxOutputChars = options.maxOutputChars ?? 80_000

  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false

    const trim = (value: string) => value.slice(0, maxOutputChars)
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout = trim(stdout + chunk)
    })
    child.stderr.on('data', (chunk: string) => {
      stderr = trim(stderr + chunk)
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const redacted = redactSecrets(error.message)
      resolve({
        command,
        args,
        exitCode: 1,
        stdout: '',
        stderr: redacted.value,
        timedOut,
        redacted: redacted.redacted,
      })
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const cleanStdout = redactSecrets(stdout)
      const cleanStderr = redactSecrets(stderr)
      resolve({
        command,
        args,
        exitCode: code ?? (timedOut ? 124 : 1),
        stdout: cleanStdout.value,
        stderr: cleanStderr.value,
        timedOut,
        redacted: cleanStdout.redacted || cleanStderr.redacted,
      })
    })
  })
}
