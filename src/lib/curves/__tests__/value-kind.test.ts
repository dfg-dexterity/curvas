import { describe, expect, it } from 'vitest'
import { fmtDelta, fmtValue, fmtValueFull, isRateKind, valueKindFor, valueUnitLabel } from '../value-kind'

describe('valueKindFor — classes do Manual de Curvas', () => {
  it('forwards de moeda são PREÇO (Manual §4.1–4.3), não percentual', () => {
    expect(valueKindFor('PTX')).toBe('price')
    expect(valueKindFor('EUR')).toBe('price')
    expect(valueKindFor('JPY')).toBe('price')
  })

  it('índices são pontos e SDE é spread', () => {
    expect(valueKindFor('INP')).toBe('index')
    expect(valueKindFor('BRP')).toBe('index')
    expect(valueKindFor('SDE')).toBe('spread')
  })

  it('juros mantêm a base convencional; desconhecido cai em rate252', () => {
    expect(valueKindFor('PRE')).toBe('rate252')
    expect(valueKindFor('TR')).toBe('rate252')
    expect(valueKindFor('DPL')).toBe('rate252')
    expect(valueKindFor('DOL')).toBe('rate360')
    expect(valueKindFor('XYZ')).toBe('rate252')
    expect(isRateKind('price')).toBe(false)
  })
})

describe('formatação por classe', () => {
  it('taxa com %, preço sem % e com mais casas, índice em pontos', () => {
    expect(fmtValue('rate252', 14.15)).toBe('14,15%')
    expect(fmtValue('price', 5.6114)).toBe('5,6114')
    expect(fmtValue('index', 142350.4)).toBe('142.350')
    expect(fmtValue('spread', -1.29)).toBe('-1,29')
    expect(fmtValue('price', null)).toBe('—')
  })

  it('tabela usa precisão plena (preço até 7 casas, taxa até 4)', () => {
    expect(fmtValueFull('price', 5.6113742)).toBe('5,6113742')
    expect(fmtValueFull('rate252', 14.1234)).toBe('14,1234')
  })

  it('delta em pp só para taxas', () => {
    expect(fmtDelta('rate252', -0.25)).toBe('0,25 pp')
    expect(fmtDelta('price', 0.1234)).toBe('0,1234')
    expect(fmtDelta('index', -1500)).toBe('1.500')
  })

  it('rótulos de unidade', () => {
    expect(valueUnitLabel('price')).toBe('preço (R$)')
    expect(valueUnitLabel('rate360')).toBe('% a.a. base 360 dias corridos')
  })
})
