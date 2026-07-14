import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from '../concurrency'

describe('mapWithConcurrency', () => {
  it('preserva a ordem dos resultados', async () => {
    const items = [30, 10, 20]
    const results = await mapWithConcurrency(items, 2, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms))
      return ms * 2
    })
    expect(results).toEqual([60, 20, 40])
  })

  it('nunca excede o limite de execuções simultâneas', async () => {
    let inFlight = 0
    let peak = 0
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
    })
    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBeGreaterThan(1)
  })

  it('funciona com lista vazia', async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([])
  })
})
