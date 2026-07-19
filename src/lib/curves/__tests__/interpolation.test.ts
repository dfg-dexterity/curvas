import { describe, expect, it } from 'vitest'
import { businessDaysForCalendarDays, easterSunday, isBusinessDayBR } from '../calendar'
import {
  applyRounding,
  buildInterpolator,
  curveConfigFor,
  interpolateAt,
  type CurveConfig,
  type Vertex,
} from '../interpolation'

const f252 = (rate: number, du: number) => (1 + rate / 100) ** (du / 252)
const fLin = (rate: number, dc: number) => 1 + (rate * dc) / 36_000
const f360 = (rate: number, dc: number) => (1 + rate / 100) ** (dc / 360)

describe('calendário ANBIMA (calendar.ts)', () => {
  it('calcula a Páscoa corretamente', () => {
    expect(easterSunday(2026).toISOString().slice(0, 10)).toBe('2026-04-05')
    expect(easterSunday(2024).toISOString().slice(0, 10)).toBe('2024-03-31')
  })

  it('reconhece feriados fixos e móveis de 2026', () => {
    expect(isBusinessDayBR(new Date(Date.UTC(2026, 3, 21)))).toBe(false) // Tiradentes (ter)
    expect(isBusinessDayBR(new Date(Date.UTC(2026, 1, 16)))).toBe(false) // segunda de Carnaval
    expect(isBusinessDayBR(new Date(Date.UTC(2026, 1, 17)))).toBe(false) // terça de Carnaval
    expect(isBusinessDayBR(new Date(Date.UTC(2026, 3, 3)))).toBe(false) // Sexta-feira Santa
    expect(isBusinessDayBR(new Date(Date.UTC(2026, 5, 4)))).toBe(false) // Corpus Christi
    expect(isBusinessDayBR(new Date(Date.UTC(2026, 10, 20)))).toBe(false) // Consciência Negra
    expect(isBusinessDayBR(new Date(Date.UTC(2026, 6, 17)))).toBe(true) // sexta comum
  })

  it('reproduz os pares (DC, DU) publicados pela B3 para 2026-07-16', () => {
    // Pares observados no GetList de PRE/DOL/DIC em produção (day360, day252).
    expect(businessDaysForCalendarDays('2026-07-16', 3)).toBe(1)
    expect(businessDaysForCalendarDays('2026-07-16', 6)).toBe(4)
    expect(businessDaysForCalendarDays('2026-07-16', 7)).toBe(5)
    expect(businessDaysForCalendarDays('2026-07-16', 12)).toBe(8)
    expect(businessDaysForCalendarDays('2026-07-16', 868)).toBe(594)
  })
})

describe('interpolateAt — propriedades definidoras de cada fórmula do manual', () => {
  const cfg = (partial: Partial<CurveConfig>): CurveConfig => ({
    method: 'ff252',
    extrapolateEnd: 'segment',
    extrapolateStart: 'segment',
    ...partial,
  })

  it('retorna o valor publicado em vértice exato', () => {
    const vertices: Vertex[] = [
      { dc: 30, du: 21, rate: 13.65 },
      { dc: 60, du: 42, rate: 13.9 },
    ]
    expect(interpolateAt(vertices, { dc: 30, du: 21 }, cfg({}))).toBe(13.65)
  })

  it('1.4.2 Flat Forward 252: o forward diário é constante dentro do segmento', () => {
    const a: Vertex = { dc: 30, du: 21, rate: 13.65 }
    const b: Vertex = { dc: 60, du: 42, rate: 13.9 }
    const t = { dc: 45, du: 30 }
    const i = interpolateAt([a, b], t, cfg({ method: 'ff252' }))

    const fwdSegment = (f252(b.rate, b.du) / f252(a.rate, a.du)) ** (1 / (b.du - a.du))
    const fwdToTarget = (f252(i, t.du) / f252(a.rate, a.du)) ** (1 / (t.du - a.du))
    expect(fwdToTarget).toBeCloseTo(fwdSegment, 12)
  })

  it('1.4.1 Exponencial 252: (1+i) é geométrico em DU', () => {
    const a: Vertex = { dc: 30, du: 21, rate: 12 }
    const b: Vertex = { dc: 60, du: 42, rate: 14 }
    const mid = { dc: 45, du: 31.5 }
    const i = interpolateAt([a, b], mid, cfg({ method: 'exp252' }))
    expect(1 + i / 100).toBeCloseTo(Math.sqrt((1 + a.rate / 100) * (1 + b.rate / 100)), 12)
  })

  it('1.4.3 FF252 com Convenção Linear: forward do fator linear constante (expoente em DU)', () => {
    const a: Vertex = { dc: 91, du: 63, rate: 5.5 }
    const b: Vertex = { dc: 182, du: 126, rate: 6.1 }
    const t = { dc: 120, du: 84 }
    const i = interpolateAt([a, b], t, cfg({ method: 'ffLinear360' }))

    const fwdSegment = (fLin(b.rate, b.dc) / fLin(a.rate, a.dc)) ** (1 / (b.du - a.du))
    const fwdToTarget = (fLin(i, t.dc) / fLin(a.rate, a.dc)) ** (1 / (t.du - a.du))
    expect(fwdToTarget).toBeCloseTo(fwdSegment, 12)
  })

  it('1.4.4 Interpolação 360: forward do fator composto 360 constante em DC', () => {
    const a: Vertex = { dc: 90, du: 62, rate: 4.2 }
    const b: Vertex = { dc: 180, du: 124, rate: 4.8 }
    const t = { dc: 150, du: 104 }
    const i = interpolateAt([a, b], t, cfg({ method: 'exp360' }))

    const fwdSegment = (f360(b.rate, b.dc) / f360(a.rate, a.dc)) ** (1 / (b.dc - a.dc))
    const fwdToTarget = (f360(i, t.dc) / f360(a.rate, a.dc)) ** (1 / (t.dc - a.dc))
    expect(fwdToTarget).toBeCloseTo(fwdSegment, 12)
  })

  it('1.4.5 Preços: ponto médio em DU é a média geométrica', () => {
    const a: Vertex = { dc: 30, du: 20, rate: 5.1234567 }
    const b: Vertex = { dc: 60, du: 40, rate: 5.7654321 }
    const i = interpolateAt([a, b], { dc: 45, du: 30 }, cfg({ method: 'price' }))
    expect(i).toBeCloseTo(Math.sqrt(a.rate * b.rate), 12)
  })

  it('1.4.11 Linear 360: a capitalização i·DC/36000 é linear em DC', () => {
    const a: Vertex = { dc: 30, du: 21, rate: 1.2 }
    const b: Vertex = { dc: 90, du: 63, rate: 1.8 }
    const t = { dc: 60, du: 42 }
    const i = interpolateAt([a, b], t, cfg({ method: 'linear360' }))
    const capMid = ((a.rate * a.dc) / 36_000 + (b.rate * b.dc) / 36_000) / 2
    expect((i * t.dc) / 36_000).toBeCloseTo(capMid, 12)
  })

  it('1.4.6 extrapolação (fim): prolonga o forward do último segmento', () => {
    const a: Vertex = { dc: 300, du: 208, rate: 14.2 }
    const b: Vertex = { dc: 400, du: 276, rate: 14.35 }
    const t = { dc: 500, du: 345 }
    const i = interpolateAt([a, b], t, cfg({ method: 'ff252', extrapolateEnd: 'segment' }))

    const fwdSegment = (f252(b.rate, b.du) / f252(a.rate, a.du)) ** (1 / (b.du - a.du))
    const fwdBeyond = (f252(i, t.du) / f252(b.rate, b.du)) ** (1 / (t.du - b.du))
    expect(fwdBeyond).toBeCloseTo(fwdSegment, 12)
  })

  it('1.4.8 extrapolação flat (fim): repete o último vértice', () => {
    const vertices: Vertex[] = [
      { dc: 30, du: 21, rate: 100_000 },
      { dc: 60, du: 42, rate: 101_000 },
    ]
    const i = interpolateAt(vertices, { dc: 90, du: 63 }, cfg({ method: 'price', extrapolateEnd: 'flat' }))
    expect(i).toBe(101_000)
  })

  it('1.4.7 extrapolação (início): usa o primeiro segmento com expoente negativo', () => {
    const a: Vertex = { dc: 30, du: 21, rate: 13.5 }
    const b: Vertex = { dc: 60, du: 42, rate: 13.8 }
    const t = { dc: 15, du: 10 }
    const i = interpolateAt([a, b], t, cfg({ method: 'ff252', extrapolateStart: 'segment' }))
    const fwdSegment = (f252(b.rate, b.du) / f252(a.rate, a.du)) ** (1 / (b.du - a.du))
    const fwdBefore = (f252(a.rate, a.du) / f252(i, t.du)) ** (1 / (a.du - t.du))
    expect(fwdBefore).toBeCloseTo(fwdSegment, 12)
  })
})

describe('applyRounding — convenções do manual', () => {
  it('arredonda afastando do zero (PRE: 3ª casa)', () => {
    expect(applyRounding(13.80049, { mode: 'round', decimals: 3 })).toBe(13.8)
    expect(applyRounding(13.8005, { mode: 'round', decimals: 3 })).toBe(13.801)
    expect(applyRounding(-40.8505, { mode: 'round', decimals: 3 })).toBe(-40.851)
  })

  it('trunca preços na 7ª casa (PTX/EUR/JPY)', () => {
    expect(applyRounding(5.123456789, { mode: 'trunc', decimals: 7 })).toBe(5.1234567)
    expect(applyRounding(-5.123456789, { mode: 'trunc', decimals: 7 })).toBe(-5.1234567)
  })
})

describe('curveConfigFor', () => {
  it('mapeia curvas do manual e sinaliza códigos desconhecidos', () => {
    expect(curveConfigFor('PRE')).toEqual({
      config: { method: 'ff252', extrapolateEnd: 'segment', extrapolateStart: 'segment', rounding: { mode: 'round', decimals: 3 } },
      known: true,
    })
    expect(curveConfigFor('DOL').config.method).toBe('ffLinear360')
    expect(curveConfigFor('PTX').config.rounding).toEqual({ mode: 'trunc', decimals: 7 })
    expect(curveConfigFor('INP').config.extrapolateEnd).toBe('flat')
    expect(curveConfigFor('ZZZ').known).toBe(false)
  })
})

describe('buildInterpolator — integração com calendário', () => {
  it('interpola a PRE contando DU no calendário ANBIMA a partir da data-base', () => {
    // Vértices reais do GetList de 2026-07-16 (dc=3 → du=1; dc=12 → du=8).
    const curve = buildInterpolator('PRE', '2026-07-16', [
      { days: 3, rate: 14.15 },
      { days: 12, rate: 14.15 },
    ])
    expect(curve.known).toBe(true)
    // Entre vértices com a mesma taxa, flat forward devolve a mesma taxa.
    expect(curve.atCalendarDays(7)).toBeCloseTo(14.15, 10)
    // Vértice exato devolve o publicado.
    expect(curve.atCalendarDays(3)).toBe(14.15)
  })
})
