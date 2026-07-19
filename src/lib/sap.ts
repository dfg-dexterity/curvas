import type { CurvePointJSON } from './ingest'

/**
 * Exportação de curvas para o SAP, no padrão do desenvolvimento anterior de
 * integração: um registro por vértice, com o código da curva ACRESCIDO do dia
 * a que o valor se refere — ex.: DIPRE001 = 1º dia da curva DI x pré na data.
 *
 * O sufixo numérico é configurável ("numbering"):
 * - 'index' (padrão): posição sequencial do vértice na curva (001, 002, …);
 * - 'dc': dias corridos do vértice (003, 006, …);
 * - 'du': dias úteis do vértice no calendário ANBIMA.
 */

/** Código SAP de cada curva. Não mapeada → usa o próprio código da taxa. */
export const SAP_CURVE_CODES: Record<string, string> = {
  PRE: 'DIPRE',
}

export type SapNumbering = 'index' | 'dc' | 'du'

export interface SapExportOptions {
  numbering?: SapNumbering
  separator?: string
  /** Inclui linha de cabeçalho (padrão: sem — estilo arquivo SAP). */
  header?: boolean
  /** Colunas extras entre a data e a taxa. */
  includeDc?: boolean
  includeDu?: boolean
  /** Calcula DU do vértice (obrigatório quando numbering='du' ou includeDu). */
  duForDc?: (dc: number) => number
}

export function sapCurveCode(rateCode: string): string {
  return SAP_CURVE_CODES[rateCode.toUpperCase()] ?? rateCode.toUpperCase()
}

/** DD.MM.AAAA — formato de data usual em cargas SAP. */
export function fmtSapDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-')
  return `${d}.${m}.${y}`
}

/** Decimal com vírgula, sem separador de milhar. */
export function fmtSapNumber(value: number): string {
  return String(value).replace('.', ',')
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

export interface SapExportResult {
  content: string
  lines: number
}

/**
 * Gera as linhas SAP de uma curva: CODIGO<dia>;DATA[;DC][;DU];TAXA.
 * Pontos sem valor na base publicada são ignorados. A numeração usa largura
 * mínima de 3 dígitos (DIPRE001), crescendo se o sufixo exigir mais.
 */
export function buildSapCurveExport(
  rateCode: string,
  dateISO: string,
  points: CurvePointJSON[],
  opts: SapExportOptions = {},
): SapExportResult {
  const numbering = opts.numbering ?? 'index'
  const sep = opts.separator ?? ';'
  const needsDu = numbering === 'du' || opts.includeDu
  if (needsDu && !opts.duForDc) {
    throw new Error("numbering='du'/includeDu exigem a função duForDc.")
  }

  const base = sapCurveCode(rateCode)
  const date = fmtSapDate(dateISO)

  const rows = [...points]
    .sort((a, b) => a.days - b.days)
    .map((p) => ({ dc: p.days, rate: p.rate252 ?? p.rate360 }))
    .filter((p): p is { dc: number; rate: number } => p.rate !== null)

  const suffixFor = (row: { dc: number }, index: number): number => {
    if (numbering === 'dc') return row.dc
    if (numbering === 'du') return opts.duForDc!(row.dc)
    return index + 1
  }
  const suffixes = rows.map((row, i) => suffixFor(row, i))
  const width = Math.max(3, ...suffixes.map((s) => String(s).length))

  const lines: string[] = []
  if (opts.header) {
    lines.push(
      ['CODIGO', 'DATA', opts.includeDc ? 'DIAS_CORRIDOS' : null, opts.includeDu ? 'DIAS_UTEIS' : null, 'TAXA']
        .filter((c): c is string => c !== null)
        .join(sep),
    )
  }
  rows.forEach((row, i) => {
    lines.push(
      [
        `${base}${pad(suffixes[i], width)}`,
        date,
        opts.includeDc ? String(row.dc) : null,
        opts.includeDu ? String(opts.duForDc!(row.dc)) : null,
        fmtSapNumber(row.rate),
      ]
        .filter((c): c is string => c !== null)
        .join(sep),
    )
  })

  return { content: lines.join('\r\n') + '\r\n', lines: rows.length }
}
