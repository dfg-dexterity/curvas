const pct2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct4 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

/** 13.6532 -> "13,65%" (resumo) */
export function fmtPct(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${pct2.format(value)}%`
}

/** 13.6532 -> "13,6532" (tabela, sem símbolo) */
export function fmtRate(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : pct4.format(value)
}

/** Prazo em dias corridos -> rótulo curto ("21d", "3m", "1a", "2,5a"). */
export function fmtDaysLabel(days: number): string {
  if (days < 60) return `${days}d`
  if (days < 360) return `${Math.round(days / 30.44)}m`
  const rounded = Math.round((days / 365.25) * 2) / 2
  const label = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',')
  return `${label}a`
}

/** "2024-01-15" -> "15/01/2024" */
export function fmtDateBr(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/** "2024-01-15" -> "15/01/24" (rótulos compactos) */
export function fmtDateShortBr(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(2)}`
}
