import { businessDaysForCalendarDays } from './calendar'

/**
 * Interpolação de curvas conforme o Manual de Curvas da B3 (v. 12/12/2025),
 * seção 1.4 — cada função abaixo referencia o item correspondente do manual.
 *
 * Convenções do manual:
 * - Vértices são pares (DC, DU) = (dias corridos, dias úteis), com DU contado
 *   no calendário de feriados nacionais (ANBIMA) — ver ./calendar.ts;
 * - Taxas em % a.a.; base 252 compõe sobre DU/252, convenção linear usa
 *   i·DC/36000, base 360 compõe sobre DC/360;
 * - Cada curva define sua função de interpolação, sua extrapolação e o
 *   arredondamento/truncamento do valor final (mapa CURVE_CONFIGS abaixo).
 */

export interface Vertex {
  /** Dias corridos do vértice. */
  dc: number
  /** Dias úteis do vértice (calendário ANBIMA). */
  du: number
  /** Taxa em % a.a. (ou preço, para curvas de preço). */
  rate: number
}

export interface TargetDay {
  dc: number
  du: number
}

export type InterpolationMethod =
  | 'exp252' // 1.4.1  Interpolação Exponencial 252
  | 'ff252' // 1.4.2  Interpolação Flat Forward 252
  | 'ffLinear360' // 1.4.3  Flat Forward 252 com Convenção Linear
  | 'exp360' // 1.4.4  Interpolação 360
  | 'price' // 1.4.5  Interpolação de Preços
  | 'linear360' // 1.4.11 Interpolação 360 Linear

export type Extrapolation =
  | 'segment' // prolonga o último/primeiro segmento (1.4.6/1.4.7/1.4.10)
  | 'flat' // repete o vértice extremo (1.4.8/1.4.9)
  | 'none' // fora do intervalo → erro

export interface Rounding {
  mode: 'round' | 'trunc'
  decimals: number
}

export interface CurveConfig {
  method: InterpolationMethod
  extrapolateEnd: Extrapolation
  extrapolateStart: Extrapolation
  rounding?: Rounding
}

/** Fator composto base 252: (1 + i/100)^(DU/252). */
const f252 = (rate: number, du: number) => (1 + rate / 100) ** (du / 252)
/** Fator linear 360: 1 + i·DC/36000. */
const fLin = (rate: number, dc: number) => 1 + (rate * dc) / 36_000
/** Fator composto base 360: (1 + i/100)^(DC/360). */
const f360 = (rate: number, dc: number) => (1 + rate / 100) ** (dc / 360)

/** 1.4.1 — Interpolação Exponencial 252 (geométrica sobre 1+i, pro-rata DU). */
function interpExp252(a: Vertex, b: Vertex, t: TargetDay): number {
  const w = (t.du - a.du) / (b.du - a.du)
  return ((1 + a.rate / 100) * ((1 + b.rate / 100) / (1 + a.rate / 100)) ** w - 1) * 100
}

/** 1.4.2 — Interpolação Flat Forward 252 (também 1.4.6/1.4.7 quando t está fora do segmento). */
function interpFF252(a: Vertex, b: Vertex, t: TargetDay): number {
  const w = (t.du - a.du) / (b.du - a.du)
  const factor = f252(a.rate, a.du) * (f252(b.rate, b.du) / f252(a.rate, a.du)) ** w
  return (factor ** (252 / t.du) - 1) * 100
}

/** 1.4.3 — Flat Forward 252 com Convenção Linear (também 1.4.10 fora do segmento). */
function interpFFLinear360(a: Vertex, b: Vertex, t: TargetDay): number {
  const w = (t.du - a.du) / (b.du - a.du)
  const factor = fLin(a.rate, a.dc) * (fLin(b.rate, b.dc) / fLin(a.rate, a.dc)) ** w
  return ((factor - 1) * 36_000) / t.dc
}

/** 1.4.4 — Interpolação 360 (flat forward composto em DC/360). */
function interpExp360(a: Vertex, b: Vertex, t: TargetDay): number {
  const w = (t.dc - a.dc) / (b.dc - a.dc)
  const factor = f360(a.rate, a.dc) * (f360(b.rate, b.dc) / f360(a.rate, a.dc)) ** w
  return (factor ** (360 / t.dc) - 1) * 100
}

/** 1.4.5 — Interpolação de Preços (geométrica, pro-rata DU). */
function interpPrice(a: Vertex, b: Vertex, t: TargetDay): number {
  const w = (t.du - a.du) / (b.du - a.du)
  return a.rate * (b.rate / a.rate) ** w
}

/** 1.4.11 — Interpolação 360 Linear (linear na capitalização i·DC/36000). */
function interpLinear360(a: Vertex, b: Vertex, t: TargetDay): number {
  const capA = (a.rate * a.dc) / 36_000
  const capB = (b.rate * b.dc) / 36_000
  const cap = capA + (capB - capA) * ((t.dc - a.dc) / (b.dc - a.dc))
  return (cap * 36_000) / t.dc
}

const INTERPOLATORS: Record<InterpolationMethod, (a: Vertex, b: Vertex, t: TargetDay) => number> = {
  exp252: interpExp252,
  ff252: interpFF252,
  ffLinear360: interpFFLinear360,
  exp360: interpExp360,
  price: interpPrice,
  linear360: interpLinear360,
}

/** Arredondamento/truncamento na convenção do manual (afastando do zero). */
export function applyRounding(value: number, rounding?: Rounding): number {
  if (!rounding) return value
  const factor = 10 ** rounding.decimals
  const scaled = Math.abs(value) * factor
  const adjusted = rounding.mode === 'round' ? Math.round(scaled) : Math.floor(scaled + 1e-9)
  return (Math.sign(value) || 1) * (adjusted / factor)
}

/**
 * Configuração por curva, conforme a seção da curva no Manual:
 * - PRE (2.1) e SLP (2.2): Flat Forward 252; após o último vértice, mesma
 *   fórmula com o último segmento (≡ 1.4.6); arredonda na 3ª casa.
 * - DIC (3.1) e DIM (3.3): interpolação da curva intermediária na base 252
 *   ("Interpolation252Year" no manual, sem definição fechada — adotado o Flat
 *   Forward 252, padrão da base 252 no próprio manual); arredonda na 2ª casa.
 * - TFP (2.4) e TP (2.5): curvas derivadas em base 252; arredonda na 2ª casa.
 * - DOL (4.4): interpolação 1.4.3 e extrapolação final 1.4.10; 3ª casa.
 * - DOC (4.5): interpolação e extrapolação 1.4.3 (último segmento); 2ª casa.
 * - EUC (4.7): derivada de DOC+SDE em convenção linear 360; 4ª casa.
 * - SDE (4.9): spread (TEU − TUS); interpolação linear 360 (1.4.11); 2ª casa.
 * - PTX/EUR/JPY (4.1–4.3): curvas de preço; interpolação de preços (1.4.5),
 *   truncado na 7ª casa.
 * - INP (5.2): preços com interpolação 1.4.5; após o último vértice repete o
 *   último valor (flat).
 * - ACC/DCO e demais cambiais sem seção própria: família linear 360.
 */
export const CURVE_CONFIGS: Record<string, CurveConfig> = {
  PRE: { method: 'ff252', extrapolateEnd: 'segment', extrapolateStart: 'segment', rounding: { mode: 'round', decimals: 3 } },
  SLP: { method: 'ff252', extrapolateEnd: 'segment', extrapolateStart: 'segment', rounding: { mode: 'round', decimals: 3 } },
  DIC: { method: 'ff252', extrapolateEnd: 'segment', extrapolateStart: 'segment', rounding: { mode: 'round', decimals: 2 } },
  DIM: { method: 'ff252', extrapolateEnd: 'segment', extrapolateStart: 'segment', rounding: { mode: 'round', decimals: 2 } },
  TFP: { method: 'ff252', extrapolateEnd: 'segment', extrapolateStart: 'segment', rounding: { mode: 'round', decimals: 2 } },
  TP: { method: 'ff252', extrapolateEnd: 'segment', extrapolateStart: 'segment', rounding: { mode: 'round', decimals: 2 } },
  APR: { method: 'ff252', extrapolateEnd: 'segment', extrapolateStart: 'segment', rounding: { mode: 'round', decimals: 3 } },
  DOL: { method: 'ffLinear360', extrapolateEnd: 'segment', extrapolateStart: 'segment', rounding: { mode: 'round', decimals: 3 } },
  DOC: { method: 'ffLinear360', extrapolateEnd: 'segment', extrapolateStart: 'segment', rounding: { mode: 'round', decimals: 2 } },
  DCO: { method: 'ffLinear360', extrapolateEnd: 'segment', extrapolateStart: 'segment', rounding: { mode: 'round', decimals: 2 } },
  ACC: { method: 'ffLinear360', extrapolateEnd: 'segment', extrapolateStart: 'segment', rounding: { mode: 'round', decimals: 2 } },
  EUC: { method: 'ffLinear360', extrapolateEnd: 'segment', extrapolateStart: 'segment', rounding: { mode: 'round', decimals: 4 } },
  SDE: { method: 'linear360', extrapolateEnd: 'flat', extrapolateStart: 'flat', rounding: { mode: 'round', decimals: 2 } },
  PTX: { method: 'price', extrapolateEnd: 'segment', extrapolateStart: 'segment', rounding: { mode: 'trunc', decimals: 7 } },
  EUR: { method: 'price', extrapolateEnd: 'segment', extrapolateStart: 'segment', rounding: { mode: 'trunc', decimals: 7 } },
  JPY: { method: 'price', extrapolateEnd: 'segment', extrapolateStart: 'segment', rounding: { mode: 'trunc', decimals: 7 } },
  INP: { method: 'price', extrapolateEnd: 'flat', extrapolateStart: 'flat' },
}

const DEFAULT_CONFIG: CurveConfig = {
  method: 'ff252',
  extrapolateEnd: 'segment',
  extrapolateStart: 'segment',
}

export function curveConfigFor(rateCode: string): { config: CurveConfig; known: boolean } {
  const config = CURVE_CONFIGS[rateCode.toUpperCase()]
  return config ? { config, known: true } : { config: DEFAULT_CONFIG, known: false }
}

/**
 * Interpola a curva no ponto-alvo seguindo a configuração dada.
 * `vertices` deve estar ordenado por dc (o helper ordena por segurança) e sem
 * prazos duplicados. Alvo em um vértice exato retorna o valor publicado (com
 * arredondamento da curva).
 */
export function interpolateAt(vertices: Vertex[], target: TargetDay, config: CurveConfig): number {
  if (vertices.length === 0) throw new Error('Curva sem vértices.')
  if (!(target.dc > 0) || !(target.du > 0)) {
    throw new Error('Alvo inválido: dc e du devem ser positivos (prazo à frente da data-base).')
  }

  const sorted = [...vertices].sort((a, b) => a.dc - b.dc)
  const interp = INTERPOLATORS[config.method]
  const usesDu = config.method !== 'exp360' && config.method !== 'linear360'
  const pos = (v: Vertex | TargetDay) => (usesDu ? v.du : v.dc)

  const exact = sorted.find((v) => v.dc === target.dc)
  if (exact) return applyRounding(exact.rate, config.rounding)

  const first = sorted[0]
  const last = sorted[sorted.length - 1]

  if (pos(target) < pos(first)) {
    // Antes do primeiro vértice: 1.4.7 (segmento inicial) ou 1.4.9 (flat).
    if (config.extrapolateStart === 'none' || sorted.length < 2) {
      if (config.extrapolateStart === 'flat' || sorted.length < 2) {
        return applyRounding(first.rate, config.rounding)
      }
      throw new Error(`Alvo (dc=${target.dc}) antes do primeiro vértice (dc=${first.dc}).`)
    }
    if (config.extrapolateStart === 'flat') return applyRounding(first.rate, config.rounding)
    return applyRounding(interp(sorted[0], sorted[1], target), config.rounding)
  }

  if (pos(target) > pos(last)) {
    // Após o último vértice: 1.4.6/1.4.10 (último segmento) ou 1.4.8 (flat).
    if (config.extrapolateEnd === 'flat' || sorted.length < 2) {
      return applyRounding(last.rate, config.rounding)
    }
    if (config.extrapolateEnd === 'none') {
      throw new Error(`Alvo (dc=${target.dc}) após o último vértice (dc=${last.dc}).`)
    }
    return applyRounding(interp(sorted[sorted.length - 2], last, target), config.rounding)
  }

  for (let i = 1; i < sorted.length; i++) {
    if (pos(target) <= pos(sorted[i])) {
      return applyRounding(interp(sorted[i - 1], sorted[i], target), config.rounding)
    }
  }
  return applyRounding(last.rate, config.rounding)
}

export interface CurveInterpolator {
  /** Interpola no prazo (dias corridos), calculando DU pelo calendário ANBIMA. */
  atCalendarDays(dc: number): number
  config: CurveConfig
  /** true quando a curva tem configuração explícita no manual. */
  known: boolean
}

/**
 * Constrói um interpolador para uma curva armazenada: recebe o código da taxa,
 * a data-base (ISO) e os vértices (dias corridos + taxa) do banco; os DU de
 * cada vértice e do alvo são contados no calendário ANBIMA a partir da
 * data-base — a mesma convenção (DC, DU) dos vértices padronizados do manual.
 */
export function buildInterpolator(
  rateCode: string,
  baseDateISO: string,
  points: Array<{ days: number; rate: number }>,
): CurveInterpolator {
  const { config, known } = curveConfigFor(rateCode)
  const duCache = new Map<number, number>()
  const duFor = (dc: number): number => {
    let du = duCache.get(dc)
    if (du === undefined) {
      du = businessDaysForCalendarDays(baseDateISO, dc)
      duCache.set(dc, du)
    }
    return du
  }
  const vertices: Vertex[] = points.map((p) => ({ dc: p.days, du: duFor(p.days), rate: p.rate }))

  return {
    config,
    known,
    atCalendarDays(dc: number): number {
      return interpolateAt(vertices, { dc, du: duFor(dc) }, config)
    },
  }
}
