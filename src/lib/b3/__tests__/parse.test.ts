import { describe, expect, it } from 'vitest'
import { B3ParseError } from '../types'
import { parseIntBr, parseRateBr, parseRatesPage } from '../parse'
import {
  PAGE_EMPTY,
  PAGE_GARBAGE,
  PAGE_INLINE_HEADER,
  PAGE_ONLY_360,
  PAGE_TWO_BASES,
} from './fixtures'

describe('parseIntBr', () => {
  it('interpreta inteiros com separador de milhar pt-BR', () => {
    expect(parseIntBr('3')).toBe(3)
    expect(parseIntBr(' 1.001 ')).toBe(1001)
    expect(parseIntBr('3.652')).toBe(3652)
  })

  it('rejeita células não-inteiras', () => {
    expect(parseIntBr('DIAS CORRIDOS')).toBeNull()
    expect(parseIntBr('10,52')).toBeNull()
    expect(parseIntBr('')).toBeNull()
    expect(parseIntBr('-3')).toBeNull()
  })
})

describe('parseRateBr', () => {
  it('interpreta decimais pt-BR, inclusive negativos e milhares', () => {
    expect(parseRateBr('10,52')).toBe(10.52)
    expect(parseRateBr('-0,52')).toBe(-0.52)
    expect(parseRateBr('1.234,5678')).toBe(1234.5678)
    expect(parseRateBr('12,3456')).toBe(12.3456)
  })

  it('trata vazios e traços como null', () => {
    expect(parseRateBr('')).toBeNull()
    expect(parseRateBr('-')).toBeNull()
    expect(parseRateBr('--')).toBeNull()
    expect(parseRateBr('N/D')).toBeNull()
    expect(parseRateBr('abc')).toBeNull()
  })
})

describe('parseRatesPage', () => {
  it('extrai dropdown, colunas 252/360 e vértices do layout com rowspan', () => {
    const page = parseRatesPage(PAGE_TWO_BASES)

    expect(page.options.map((o) => o.code)).toEqual(['PRE', 'DIC', 'DIM', 'DOC', 'SLP'])
    expect(page.options[0].name).toBe('DI x pré')
    expect(page.columns).toEqual({ has252: true, has360: true })
    expect(page.emptyReason).toBeUndefined()
    expect(page.warnings).toEqual([])

    expect(page.rows).toHaveLength(5)
    expect(page.rows[0]).toEqual({ days: 3, rate252: 10.65, rate360: 10.51 })
    expect(page.rows[3]).toEqual({ days: 1001, rate252: 11.25, rate360: 11.09 })
    expect(page.rows[4]).toEqual({ days: 3652, rate252: 12.3456, rate360: null })
  })

  it('NÃO confunde o subcabeçalho "252/360" com uma linha de dados', () => {
    const page = parseRatesPage(PAGE_TWO_BASES)
    expect(page.rows.find((r) => r.days === 252)).toBeUndefined()
    expect(page.rows.find((r) => r.days === 360)).toBeUndefined()
  })

  it('trata curvas que publicam apenas a base 360', () => {
    const page = parseRatesPage(PAGE_ONLY_360)
    expect(page.columns).toEqual({ has252: false, has360: true })
    expect(page.rows[0]).toEqual({ days: 3, rate252: null, rate360: -0.52 })
    expect(page.rows).toHaveLength(3)
  })

  it('trata cabeçalho em linha única (sem rowspan)', () => {
    const page = parseRatesPage(PAGE_INLINE_HEADER)
    expect(page.columns).toEqual({ has252: true, has360: false })
    expect(page.rows).toEqual([
      { days: 1, rate252: 13.15, rate360: null },
      { days: 22, rate252: 13.17, rate360: null },
    ])
  })

  it('reconhece a mensagem de "não há dados" (feriados)', () => {
    const page = parseRatesPage(PAGE_EMPTY)
    expect(page.rows).toHaveLength(0)
    expect(page.emptyReason).toMatch(/não há dados/i)
    expect(page.options.length).toBeGreaterThan(0)
  })

  it('lança B3ParseError para páginas irreconhecíveis (bloqueio/erro)', () => {
    expect(() => parseRatesPage(PAGE_GARBAGE)).toThrow(B3ParseError)
  })
})
