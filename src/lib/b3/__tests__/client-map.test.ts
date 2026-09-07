import { describe, expect, it } from 'vitest'
import { basisFor, buildSearchUrl, mapApiRow } from '../client'

describe('buildSearchUrl', () => {
  it('monta Search/<Método>/<base64(JSON)> como a SPA da B3', () => {
    const url = buildSearchUrl('GetList', { language: 'pt-br', id: 'PRE', date: '2026-07-17', pageNumber: 1, pageSize: 120 })
    const [, payload] = url.split('/Search/GetList/')
    expect(url).toContain('referenceRatesProxy/Search/GetList/')
    expect(JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'))).toEqual({
      language: 'pt-br',
      id: 'PRE',
      date: '2026-07-17',
      pageNumber: 1,
      pageSize: 120,
    })
  })
})

describe('basisFor', () => {
  it('classifica pré/inflação como 252 e cambiais como 360', () => {
    expect(basisFor('PRE')).toEqual({ basis: '252', known: true })
    expect(basisFor('DIC')).toEqual({ basis: '252', known: true })
    expect(basisFor('DOL')).toEqual({ basis: '360', known: true })
    expect(basisFor('EUC')).toEqual({ basis: '360', known: true })
  })

  it('assume 252 (com known=false) para códigos novos', () => {
    expect(basisFor('XYZ')).toEqual({ basis: '252', known: false })
  })
})

describe('mapApiRow', () => {
  it('mapeia a linha real da API: prazo=day360 (dias corridos), taxa na base do produto', () => {
    const row = { code: 'PRE', curve: 'T1', description: 'DI x pré', day252: 1, day360: 3, rate: '14,15' }
    expect(mapApiRow(row, '252')).toEqual({ days: 3, rate252: 14.15, rate360: null })
  })

  it('grava na coluna 360 para produtos lineares (ex.: DOL, curtíssimo negativo)', () => {
    const row = { code: 'DOL', curve: 'T1', description: 'DI x dólar', day252: 1, day360: 3, rate: '-40,85' }
    expect(mapApiRow(row, '360')).toEqual({ days: 3, rate252: null, rate360: -40.85 })
  })

  it('aceita prazo/taxa como número ou string pt-BR (inclusive milhar)', () => {
    expect(mapApiRow({ day360: 12449, rate: '14,43' }, '252')).toEqual({ days: 12449, rate252: 14.43, rate360: null })
    expect(mapApiRow({ day360: '12.449', rate: 14.43 }, '252')).toEqual({ days: 12449, rate252: 14.43, rate360: null })
  })

  it('rejeita linhas sem prazo ou sem taxa interpretáveis', () => {
    expect(mapApiRow({ day360: 3 }, '252')).toBeNull()
    expect(mapApiRow({ rate: '14,15' }, '252')).toBeNull()
    expect(mapApiRow({ day360: 'abc', rate: '14,15' }, '252')).toBeNull()
    expect(mapApiRow(null, '252')).toBeNull()
    expect(mapApiRow('x', '252')).toBeNull()
  })
})
