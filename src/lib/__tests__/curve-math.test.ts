import { describe, expect, it } from 'vitest'
import { availableBases, buildSharedGrid, interpolateAt, resampleCurve } from '../curve-math'
import type { CurvePointJSON } from '../ingest'

const CURVE: CurvePointJSON[] = [
  { days: 3, rate252: 10.0, rate360: 9.9 },
  { days: 7, rate252: 11.0, rate360: null },
  { days: 30, rate252: 12.0, rate360: 11.5 },
]

describe('interpolateAt', () => {
  it('devolve o vértice exato quando existe', () => {
    expect(interpolateAt(CURVE, 7, 'rate252')).toBe(11.0)
  })

  it('interpola linearmente entre vizinhos', () => {
    expect(interpolateAt(CURVE, 5, 'rate252')).toBeCloseTo(10.5, 10)
  })

  it('ignora vértices sem valor na base pedida', () => {
    // na base 360 o vértice de 7 dias é null: interpola entre 3 e 30
    expect(interpolateAt(CURVE, 7, 'rate360')).toBeCloseTo(9.9 + ((11.5 - 9.9) * 4) / 27, 10)
  })

  it('devolve null fora do domínio', () => {
    expect(interpolateAt(CURVE, 1, 'rate252')).toBeNull()
    expect(interpolateAt(CURVE, 31, 'rate252')).toBeNull()
    expect(interpolateAt([], 10, 'rate252')).toBeNull()
  })
})

describe('availableBases', () => {
  it('detecta as bases publicadas', () => {
    expect(availableBases(CURVE)).toEqual({ has252: true, has360: true })
    expect(availableBases([{ days: 3, rate252: null, rate360: 1 }])).toEqual({
      has252: false,
      has360: true,
    })
    expect(availableBases([])).toEqual({ has252: false, has360: false })
  })
})

describe('buildSharedGrid / resampleCurve', () => {
  it('cobre a união dos domínios e reamostra com null fora do domínio', () => {
    const shortCurve: CurvePointJSON[] = [
      { days: 10, rate252: 5, rate360: null },
      { days: 100, rate252: 6, rate360: null },
    ]
    const longCurve: CurvePointJSON[] = [
      { days: 3, rate252: 7, rate360: null },
      { days: 200, rate252: 8, rate360: null },
    ]

    const grid = buildSharedGrid([shortCurve, longCurve], 50)
    expect(grid[0]).toBe(3)
    expect(grid[grid.length - 1]).toBe(200)

    const resampled = resampleCurve(shortCurve, grid, 'rate252')
    expect(resampled[0]).toBeNull() // 3 dias: antes do domínio da curva curta
    expect(resampled[resampled.length - 1]).toBeNull() // 200 dias: além dele

    const interior = grid.findIndex((d) => d >= 10 && d <= 100)
    expect(interior).toBeGreaterThan(-1)
    expect(resampled[interior]).toBeGreaterThanOrEqual(5)
    expect(resampled[interior]).toBeLessThanOrEqual(6)
  })

  it('devolve grade vazia sem pontos suficientes', () => {
    expect(buildSharedGrid([])).toEqual([])
    expect(buildSharedGrid([[{ days: 5, rate252: 1, rate360: null }]])).toEqual([])
  })
})
