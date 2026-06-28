import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { ProjectConfig } from '../src/shared/types.ts'

const projectSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/),
  displayName: z.string().min(1),
  path: z.string().min(1),
  kind: z.string().min(1),
  priority: z.enum(['active', 'watch', 'archive']),
  tags: z.array(z.string().min(1)).default([]),
  devctlProject: z.string().min(1).optional(),
  composeProject: z.string().min(1).optional(),
})

const suiteConfigSchema = z.object({
  version: z.literal(1),
  developerRoot: z.string().min(1),
  devctlPath: z.string().min(1),
  notes: z.string().optional(),
  projects: z.array(projectSchema),
})

export type SuiteConfig = z.infer<typeof suiteConfigSchema> & {
  projects: ProjectConfig[]
}

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const configPath = path.join(repoRoot, 'config', 'projects.json')

export function getRepoRoot(): string {
  return repoRoot
}

export function loadConfig(): SuiteConfig {
  const raw = fs.readFileSync(configPath, 'utf8')
  const parsed = suiteConfigSchema.parse(JSON.parse(raw))
  const ids = new Set<string>()
  const paths = new Set<string>()

  for (const project of parsed.projects) {
    if (ids.has(project.id)) {
      throw new Error(`duplicate project id: ${project.id}`)
    }
    ids.add(project.id)

    const normalizedPath = path.resolve(project.path)
    if (paths.has(normalizedPath)) {
      throw new Error(`duplicate project path: ${normalizedPath}`)
    }
    paths.add(normalizedPath)
  }

  return parsed
}
