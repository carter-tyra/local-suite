import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { getRepoRoot } from './config.ts'
import { listenerRuleKey } from '../src/shared/listenerRules.ts'
import type {
  IgnoredListenerRule,
  ListenerPort,
  ListenerRuleMutationResult,
  ListenerRulePreview,
  ListenerRulesFile,
  ListenerRulesSummary,
} from '../src/shared/types.ts'

const listenerScopeSchema = z.enum(['local', 'public', 'unknown'])

const ignoredListenerRuleSchema = z
  .object({
    bindIp: z.string().min(1).max(80),
    command: z.string().min(1).max(120),
    createdAt: z.string().datetime(),
    key: z.string().min(1).max(320),
    port: z.string().regex(/^\d{1,5}$/),
    reason: z.string().min(1).max(160),
    scope: listenerScopeSchema,
  })
  .superRefine((rule, context) => {
    if (listenerRuleKey(rule) !== rule.key) {
      context.addIssue({
        code: 'custom',
        message: 'listener rule key does not match rule identity',
        path: ['key'],
      })
    }
  })

const listenerRulesFileSchema = z.object({
  version: z.literal(1),
  ignored: z.array(ignoredListenerRuleSchema),
})

export const listenerRuleRequestSchema = z
  .object({
    bindIp: z.string().min(1).max(80),
    command: z.string().min(1).max(120),
    key: z.string().min(1).max(320),
    port: z.string().regex(/^\d{1,5}$/),
    reason: z.string().trim().max(160).optional(),
    scope: listenerScopeSchema,
  })
  .superRefine((rule, context) => {
    const numericPort = Number(rule.port)
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65_535) {
      context.addIssue({
        code: 'custom',
        message: 'port must be between 1 and 65535',
        path: ['port'],
      })
    }

    if (listenerRuleKey(rule) !== rule.key) {
      context.addIssue({
        code: 'custom',
        message: 'listener rule key does not match rule identity',
        path: ['key'],
      })
    }
  })

type ListenerRuleInput = z.infer<typeof listenerRuleRequestSchema>

const defaultRulesFile: ListenerRulesFile = {
  version: 1,
  ignored: [],
}

const defaultRulesPath = path.join(getRepoRoot(), 'config', 'listener-rules.json')

export async function readListenerRules(rulesPath = defaultRulesPath): Promise<ListenerRulesFile> {
  try {
    const raw = await fs.readFile(rulesPath, 'utf8')
    return listenerRulesFileSchema.parse(JSON.parse(raw))
  } catch (error) {
    if (isNotFound(error)) return defaultRulesFile
    throw error
  }
}

export function summarizeListenerRules(rules: ListenerRulesFile): ListenerRulesSummary {
  return {
    ignored: rules.ignored,
    ignoredCount: rules.ignored.length,
  }
}

export function applyListenerRulesToListeners(
  listeners: ListenerPort[],
  rules: ListenerRulesFile,
): ListenerPort[] {
  const ignoredByKey = new Map(rules.ignored.map((rule) => [rule.key, rule]))

  return listeners.map((listener) => {
    const rule = ignoredByKey.get(listener.ruleKey)
    if (!rule) {
      return {
        ...listener,
        classification: null,
        classificationReason: null,
      }
    }

    return {
      ...listener,
      classification: 'ignored',
      classificationReason: rule.reason,
    }
  })
}

export function previewIgnoredListenerRule(
  input: ListenerRuleInput,
  listeners: ListenerPort[],
  rules: ListenerRulesFile,
): ListenerRulePreview {
  const matchingListeners = listeners.filter((listener) => listener.ruleKey === input.key).length
  const existingRule = rules.ignored.find((rule) => rule.key === input.key) ?? null

  return {
    action: 'ignore',
    alreadyIgnored: Boolean(existingRule),
    generatedAt: new Date().toISOString(),
    key: input.key,
    matchingListeners,
    reason: existingRule?.reason ?? normalizeReason(input.reason),
  }
}

export async function upsertIgnoredListenerRule(
  input: ListenerRuleInput,
  listeners: ListenerPort[],
  rulesPath = defaultRulesPath,
): Promise<ListenerRuleMutationResult> {
  const rules = await readListenerRules(rulesPath)
  const preview = previewIgnoredListenerRule(input, listeners, rules)

  if (!preview.alreadyIgnored) {
    const nextRules: ListenerRulesFile = {
      version: 1,
      ignored: [
        ...rules.ignored,
        {
          bindIp: input.bindIp,
          command: input.command,
          createdAt: new Date().toISOString(),
          key: input.key,
          port: input.port,
          reason: preview.reason,
          scope: input.scope,
        },
      ].sort(sortIgnoredRules),
    }
    await writeListenerRules(nextRules, rulesPath)
  }

  const currentRules = preview.alreadyIgnored ? rules : await readListenerRules(rulesPath)
  return {
    ...preview,
    applied: true,
    ignoredCount: currentRules.ignored.length,
  }
}

async function writeListenerRules(rules: ListenerRulesFile, rulesPath: string): Promise<void> {
  const parsed = listenerRulesFileSchema.parse(rules)
  await fs.mkdir(path.dirname(rulesPath), { recursive: true })
  const tmpPath = `${rulesPath}.${process.pid}.tmp`
  await fs.writeFile(tmpPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
  await fs.rename(tmpPath, rulesPath)
}

function normalizeReason(reason: string | undefined): string {
  const trimmed = reason?.trim()
  return trimmed || 'Ignored local listener'
}

function sortIgnoredRules(left: IgnoredListenerRule, right: IgnoredListenerRule): number {
  return left.scope.localeCompare(right.scope) || Number(left.port) - Number(right.port) || left.key.localeCompare(right.key)
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
