/**
 * Classe de valor de cada curva, conforme a seção "Valores" de cada curva no
 * Manual de Curvas da B3 — valida também com os dados reais da API:
 * - rate252 / rate360: taxa em % a.a. (base 252 dias úteis ou 360 corridos);
 * - price: PREÇO — os forwards de moeda (PTX Real x dólar, EUR Real x euro,
 *   JPY Real x iene) são "valor em preço com 7 casas decimais, truncado"
 *   (Manual §4.1–4.3), não percentual;
 * - index: pontos de índice (INP Ibovespa §5.2, BRP IBrX-50 §5.1);
 * - spread: diferencial em "preço (spread)" (SDE §4.9).
 */

export type ValueKind = 'rate252' | 'rate360' | 'price' | 'index' | 'spread'

export const CURVE_VALUE_KINDS: Record<string, ValueKind> = {
  // Taxas % a.a. base 252 dias úteis (composto)
  PRE: 'rate252',
  SLP: 'rate252',
  APR: 'rate252',
  DIC: 'rate252',
  DIM: 'rate252',
  DPL: 'rate252',
  TP: 'rate252',
  TFP: 'rate252',
  TR: 'rate252',
  // Taxas % a.a. base 360 dias corridos (linear)
  DOL: 'rate360',
  DOC: 'rate360',
  DCO: 'rate360',
  ACC: 'rate360',
  EUC: 'rate360',
  LIB: 'rate360',
  // Preços (forwards de moeda — Manual §4.1–4.3, truncado na 7ª casa)
  PTX: 'price',
  EUR: 'price',
  JPY: 'price',
  // Pontos de índice
  INP: 'index',
  BRP: 'index',
  // Spreads
  SDE: 'spread',
}

export function valueKindFor(rateCode: string): ValueKind {
  return CURVE_VALUE_KINDS[rateCode.toUpperCase()] ?? 'rate252'
}

export function isRateKind(kind: ValueKind): boolean {
  return kind === 'rate252' || kind === 'rate360'
}

const nfPct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nfPctFull = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const nfPrice = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const nfPriceFull = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 7 })
const nfIndex = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const nfSpread = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Valor resumido (cards, tooltip, painel): "14,15%", "5,6114", "142.350", "-1,29". */
export function fmtValue(kind: ValueKind, value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  switch (kind) {
    case 'rate252':
    case 'rate360':
      return `${nfPct.format(value)}%`
    case 'price':
      return nfPrice.format(value)
    case 'index':
      return nfIndex.format(value)
    case 'spread':
      return nfSpread.format(value)
  }
}

/** Valor completo (tabela): taxas com até 4 casas, preços com até 7. */
export function fmtValueFull(kind: ValueKind, value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  switch (kind) {
    case 'rate252':
    case 'rate360':
      return nfPctFull.format(value)
    case 'price':
      return nfPriceFull.format(value)
    case 'index':
      return nfIndex.format(value)
    case 'spread':
      return nfSpread.format(value)
  }
}

/** Rótulo da unidade (títulos de gráfico/tabela). */
export function valueUnitLabel(kind: ValueKind): string {
  switch (kind) {
    case 'rate252':
      return '% a.a. base 252 dias úteis'
    case 'rate360':
      return '% a.a. base 360 dias corridos'
    case 'price':
      return 'preço (R$)'
    case 'index':
      return 'pontos'
    case 'spread':
      return 'spread (diferencial de taxas)'
  }
}

/** Rótulo curto para chips. */
export function valueChipLabel(kind: ValueKind): string {
  switch (kind) {
    case 'rate252':
      return 'base 252 du'
    case 'rate360':
      return 'base 360 dc'
    case 'price':
      return 'preço'
    case 'index':
      return 'pontos'
    case 'spread':
      return 'spread'
  }
}

/** Diferença entre dois valores da curva (comparações): "pp" só para taxas. */
export function fmtDelta(kind: ValueKind, delta: number): string {
  const abs = Math.abs(delta)
  if (isRateKind(kind)) return `${nfPct.format(abs)} pp`
  if (kind === 'index') return nfIndex.format(abs)
  return nfPrice.format(abs)
}
