export function formatMib(value: number): string {
  if (!Number.isFinite(value)) return '-'
  if (value >= 1024) return `${(value / 1024).toFixed(2)} GiB`
  return `${Math.round(value)} MiB`
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '-'
  return `${value.toFixed(2)}%`
}

export function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`
}
