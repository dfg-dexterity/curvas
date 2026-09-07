import { describe, expect, it } from 'vitest'
import { buildSapCurveExport, fmtSapDate, fmtSapNumber, sapCurveCode } from '../sap'

const POINTS = [
  { days: 3, rate252: 14.15, rate360: null },
  { days: 6, rate252: 14.15, rate360: null },
  { days: 868, rate252: 14.31, rate360: null },
]

describe('sapCurveCode', () => {
  it('mapeia PRE para DIPRE e mantém códigos não mapeados', () => {
    expect(sapCurveCode('PRE')).toBe('DIPRE')
    expect(sapCurveCode('DOL')).toBe('DOL')
  })
})

describe('formatos SAP', () => {
  it('data DD.MM.AAAA e decimal com vírgula', () => {
    expect(fmtSapDate('2026-07-17')).toBe('17.07.2026')
    expect(fmtSapNumber(14.15)).toBe('14,15')
    expect(fmtSapNumber(-40.85)).toBe('-40,85')
  })
})

describe('buildSapCurveExport', () => {
  it('numera sequencialmente com 3 dígitos: DIPRE001 é o 1º dia da curva', () => {
    const { content, lines } = buildSapCurveExport('PRE', '2026-07-17', POINTS)
    expect(lines).toBe(3)
    expect(content).toBe(
      'DIPRE001;17.07.2026;14,15\r\n' + 'DIPRE002;17.07.2026;14,15\r\n' + 'DIPRE003;17.07.2026;14,31\r\n',
    )
  })

  it('numera por dias corridos quando numbering=dc (largura acompanha o maior sufixo)', () => {
    const { content } = buildSapCurveExport('PRE', '2026-07-17', POINTS, { numbering: 'dc' })
    expect(content.split('\r\n')[0]).toBe('DIPRE003;17.07.2026;14,15')
    expect(content).toContain('DIPRE868;17.07.2026;14,31')
  })

  it('numera por dias úteis com duForDc e aceita colunas extras + cabeçalho', () => {
    const du = (dc: number) => ({ 3: 1, 6: 4, 868: 594 })[dc] ?? 0
    const { content } = buildSapCurveExport('PRE', '2026-07-17', POINTS, {
      numbering: 'du',
      includeDc: true,
      includeDu: true,
      header: true,
      duForDc: du,
    })
    const rows = content.trimEnd().split('\r\n')
    expect(rows[0]).toBe('CODIGO;DATA;DIAS_CORRIDOS;DIAS_UTEIS;TAXA')
    expect(rows[1]).toBe('DIPRE001;17.07.2026;3;1;14,15')
    expect(rows[3]).toBe('DIPRE594;17.07.2026;868;594;14,31')
  })

  it('usa a base 360 quando é a publicada e ignora pontos sem valor', () => {
    const { content, lines } = buildSapCurveExport('DOL', '2026-07-17', [
      { days: 3, rate252: null, rate360: -40.85 },
      { days: 6, rate252: null, rate360: null },
    ])
    expect(lines).toBe(1)
    expect(content).toBe('DOL001;17.07.2026;-40,85\r\n')
  })

  it("exige duForDc quando numbering='du'", () => {
    expect(() => buildSapCurveExport('PRE', '2026-07-17', POINTS, { numbering: 'du' })).toThrow(
      /duForDc/,
    )
  })
})
