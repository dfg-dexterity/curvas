import type { CurvePointJSON } from './ingest'

export type RateBase = 'rate252' | 'rate360'

/**
 * Taxa no prazo `days` por interpolação linear entre os vértices vizinhos
 * (mesma convenção exibida na UI; null fora do domínio da curva).
 */
export function interpolateAt(points: CurvePointJSON[], days: number, base: RateBase): number | null {
  let lower: CurvePointJSON | null = null
  let upper: CurvePointJSON | null = null

  for (const point of points) {
    if (point[base] === null) continue
    if (point.days === days) return point[base]
    if (point.days < days) {
      if (!lower || point.days > lower.days) lower = point
    } else if (!upper || point.days < upper.days) {
      upper = point
    }
  }

  if (!lower || !upper) return null
  const y0 = lower[base] as number
  const y1 = upper[base] as number
  return y0 + ((y1 - y0) * (days - lower.days)) / (upper.days - lower.days)
}

/** Quais bases a curva efetivamente publica. */
export function availableBases(points: CurvePointJSON[]): { has252: boolean; has360: boolean } {
  let has252 = false
  let has360 = false
  for (const p of points) {
    if (p.rate252 !== null) has252 = true
    if (p.rate360 !== null) has360 = true
    if (has252 && has360) break
  }
  return { has252, has360 }
}

/**
 * Grade comum de prazos para sobrepor curvas de datas diferentes (os vértices
 * publicados mudam a cada dia). Amostra uniformemente a união dos domínios.
 */
export function buildSharedGrid(curves: CurvePointJSON[][], size = 200): number[] {
  let min = Infinity
  let max = -Infinity
  for (const points of curves) {
    if (points.length === 0) continue
    min = Math.min(min, points[0].days)
    max = Math.max(max, points[points.length - 1].days)
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return []

  const grid: number[] = []
  const step = (max - min) / (size - 1)
  for (let i = 0; i < size; i++) grid.push(Math.round(min + i * step))
  return [...new Set(grid)]
}

/** Reamostra uma curva na grade comum (null fora do domínio dela). */
export function resampleCurve(
  points: CurvePointJSON[],
  grid: number[],
  base: RateBase,
): Array<number | null> {
  return grid.map((days) => interpolateAt(points, days, base))
}
