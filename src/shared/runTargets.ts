import type { PackageSummary, RunTarget } from './types.ts'

const RUN_SCRIPT_PRIORITY = ['dev', 'start', 'serve', 'preview', 'web', 'develop'] as const

export function getRunTargets(pkg: PackageSummary | null): RunTarget[] {
  if (!pkg) return []

  const scripts = new Set(pkg.scripts)
  const orderedScripts = [
    ...RUN_SCRIPT_PRIORITY.filter((script) => scripts.has(script)),
    ...pkg.scripts.filter((script) => !RUN_SCRIPT_PRIORITY.includes(script as (typeof RUN_SCRIPT_PRIORITY)[number])),
  ]

  return orderedScripts.map((script, index) => ({
    commandLabel: packageManagerRunCommandLabel(pkg.manager, script),
    id: `script:${script}`,
    label: script === 'dev' ? 'Start dev' : `Run ${script}`,
    manager: pkg.manager,
    primary: index === 0,
    script,
  }))
}

export function getPrimaryRunTarget(pkg: PackageSummary | null): RunTarget | null {
  return getRunTargets(pkg)[0] ?? null
}

export function getRunTargetById(pkg: PackageSummary | null, targetId: string): RunTarget | null {
  return getRunTargets(pkg).find((target) => target.id === targetId) ?? null
}

export function packageManagerExecutable(manager: PackageSummary['manager']): string {
  return manager === 'unknown' ? 'npm' : manager
}

export function packageManagerRunArgs(_manager: PackageSummary['manager'], script: string): string[] {
  return ['run', script]
}

export function packageManagerRunCommandLabel(manager: PackageSummary['manager'], script: string): string {
  return `${packageManagerExecutable(manager)} ${packageManagerRunArgs(manager, script).join(' ')}`
}
