import { describe, expect, it } from 'vitest'
import { buildSearchUrl, mapApiRow } from '../client'

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

describe('mapApiRow', () => {
  it('mapeia a linha da API (description = prazo, day252/day360 = taxas)', () => {
    expect(mapApiRow({ description: '3', day252: '10,65', day360: '10,51' })).toEqual({
      days: 3,
      rate252: 10.65,
      rate360: 10.51,
    })
  })

  it('aceita milhar pt-BR no prazo e traço/vazio nas taxas', () => {
    expect(mapApiRow({ description: '1.001', day252: '11,25', day360: '-' })).toEqual({
      days: 1001,
      rate252: 11.25,
      rate360: null,
    })
    expect(mapApiRow({ description: '3.652', day252: '12,3456', day360: '' })).toEqual({
      days: 3652,
      rate252: 12.3456,
      rate360: null,
    })
  })

  it('aceita valores numéricos crus (caso a API responda números)', () => {
    expect(mapApiRow({ description: 30, day252: 13.15, day360: null })).toEqual({
      days: 30,
      rate252: 13.15,
      rate360: null,
    })
  })

  it('rejeita linhas sem prazo interpretável', () => {
    expect(mapApiRow({ description: 'DIAS CORRIDOS', day252: '252', day360: '360' })).toBeNull()
    expect(mapApiRow({ foo: 'bar' })).toBeNull()
    expect(mapApiRow(null)).toBeNull()
    expect(mapApiRow('x')).toBeNull()
  })
})
