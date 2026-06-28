import { z } from 'zod'
import type { ActionResult, SafeAction } from '../src/shared/types.ts'
import type { SuiteConfig } from './config.ts'
import { runDevctlActionPreview } from './devctl.ts'

export const actionRequestSchema = z.object({
  actionId: z.enum(['devctl-up-preview', 'devctl-down-preview', 'docker-doctor', 'stop-candidates']),
  projectId: z.string().min(1).optional(),
})

export async function runSafeAction(
  config: SuiteConfig,
  input: z.infer<typeof actionRequestSchema>,
): Promise<ActionResult> {
  const project = input.projectId
    ? config.projects.find((candidate) => candidate.id === input.projectId)
    : undefined

  const args = argsForAction(input.actionId, project?.devctlProject)
  const result = await runDevctlActionPreview(config, args)

  return {
    actionId: input.actionId as SafeAction['id'],
    projectId: input.projectId ?? null,
    command: result.command,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    redacted: result.redacted,
    generatedAt: new Date().toISOString(),
  }
}

function argsForAction(actionId: SafeAction['id'], devctlProject?: string): string[] {
  if (actionId === 'docker-doctor') return ['doctor']
  if (actionId === 'stop-candidates') return ['stop-idle']
  if (!devctlProject) {
    throw new Error('This project is not registered with devctl.')
  }
  if (actionId === 'devctl-up-preview') return ['up', devctlProject]
  if (actionId === 'devctl-down-preview') return ['down', devctlProject]
  throw new Error(`Unsupported action: ${actionId}`)
}
