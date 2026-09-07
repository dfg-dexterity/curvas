import { describe, expect, it } from 'vitest'
import { buildInterpolator } from '../../curves/interpolation'
import {
  aliquotaIOFRendimento,
  aliquotaIRRF,
  calcularImpostosRendaFixa,
  calcularIOFCredito,
} from '../impostos'
import { corrigirPorCDI, fatorCDIEntre, type PontoCDI } from '../cdi'
import { mtmOpcaoMoeda, normCdf, precificarOpcaoBlack } from '../opcoes'
import { calcularNDF, calcularSwapMtM, duEntreDatas, truncar } from '../mtm'
import {
  compararEmprestimos,
  resolverTaxaAnual,
  simularEmprestimo,
  type ParametrosEmprestimo,
} from '../emprestimos'

/** Interpolador de curva flat na taxa dada (vértices em 1 e 5000 dc). */
function curvaFlat(code: string, date: string, rate: number) {
  return buildInterpolator(code, date, [
    { days: 1, rate },
    { days: 5000, rate },
  ])
}

// ========== Impostos ==========

describe('impostos de renda fixa', () => {
  it('IOF regressivo: 96% no 1º dia, 50% no 15º, 0% do 30º em diante', () => {
    expect(aliquotaIOFRendimento(1)).toBe(96)
    expect(aliquotaIOFRendimento(15)).toBe(50)
    expect(aliquotaIOFRendimento(30)).toBe(0)
    expect(aliquotaIOFRendimento(300)).toBe(0)
  })

  it('IRRF regressivo por prazo', () => {
    expect(aliquotaIRRF(100)).toBe(22.5)
    expect(aliquotaIRRF(181)).toBe(20)
    expect(aliquotaIRRF(700)).toBe(17.5)
    expect(aliquotaIRRF(721)).toBe(15)
  })

  it('IRRF incide sobre o rendimento líquido de IOF', () => {
    const r = calcularImpostosRendaFixa(1000, 1100, 10)
    // IOF dia 10 = 66% de 100 = 66; IRRF 22,5% de 34 = 7,65
    expect(r.valorIOF).toBeCloseTo(66, 10)
    expect(r.valorIRRF).toBeCloseTo(7.65, 10)
    expect(r.valorFinalLiquido).toBeCloseTo(1000 + 100 - 66 - 7.65, 10)
  })
})

describe('IOF de crédito', () => {
  it('aplica alíquota diária limitada a 365 dias + adicional de 0,38%', () => {
    const r = calcularIOFCredito(100_000, [{ diasCorridos: 500, amortizacao: 100_000 }], 'pj')
    expect(r.iofDiario).toBeCloseTo(100_000 * 0.000041 * 365, 6)
    expect(r.iofAdicional).toBeCloseTo(380, 10)
    expect(r.total).toBeCloseTo(r.iofDiario + 380, 10)
  })

  it('PF tem alíquota diária em dobro', () => {
    const pf = calcularIOFCredito(1000, [{ diasCorridos: 100, amortizacao: 1000 }], 'pf')
    const pj = calcularIOFCredito(1000, [{ diasCorridos: 100, amortizacao: 1000 }], 'pj')
    expect(pf.iofDiario).toBeCloseTo(pj.iofDiario * 2, 10)
  })
})

// ========== CDI ==========

describe('correção pelo CDI', () => {
  const serieConstante = (n: number, rate: number): PontoCDI[] =>
    Array.from({ length: n }, (_, i) => ({
      date: `2024-01-${String(i + 2).padStart(2, '0')}`,
      rate,
    }))

  it('série constante equivale ao fator composto (1+r)^(n/252)', () => {
    const serie = serieConstante(10, 13.65)
    const r = corrigirPorCDI(1000, serie, { dataInicial: '2024-01-02', dataFinal: '2024-01-12' })
    expect(r.fatorCDI).toBeCloseTo((1 + 13.65 / 100) ** (10 / 252), 10)
  })

  it('percentual do CDI aplicado sobre a taxa anual', () => {
    const serie = serieConstante(5, 10)
    const r = corrigirPorCDI(1000, serie, {
      percentualCDI: 110,
      dataInicial: '2024-01-02',
      dataFinal: '2024-01-07',
    })
    expect(r.fatorCDI).toBeCloseTo((1 + 11 / 100) ** (5 / 252), 10)
  })

  it('fatorCDIEntre usa a janela [início, fim)', () => {
    const serie = serieConstante(5, 10) // datas 02..06
    const fator = fatorCDIEntre(serie, '2024-01-03', '2024-01-05')
    expect(fator).toBeCloseTo((1 + 10 / 100) ** (2 / 252), 12) // dias 03 e 04
  })
})

// ========== Opções ==========

describe('opções de moeda (Black sobre o forward)', () => {
  it('normCdf em pontos conhecidos', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7)
    expect(normCdf(1.959964)).toBeCloseTo(0.975, 4)
    expect(normCdf(-1.959964)).toBeCloseTo(0.025, 4)
  })

  it('paridade call-put: C − P = df·(F − K)', () => {
    const base = { forward: 5.7, strike: 5.5, volAA: 15, du: 126, taxaDesconto: 11 }
    const call = precificarOpcaoBlack({ ...base, tipo: 'call' })
    const put = precificarOpcaoBlack({ ...base, tipo: 'put' })
    const df = (1 + 0.11) ** (-126 / 252)
    expect(call.premio - put.premio).toBeCloseTo(df * (5.7 - 5.5), 10)
  })

  it('ATM: call e put têm o mesmo prêmio e delta forward ~±0,5·df', () => {
    const base = { forward: 5, strike: 5, volAA: 12, du: 252, taxaDesconto: 10 }
    const call = precificarOpcaoBlack({ ...base, tipo: 'call' })
    const put = precificarOpcaoBlack({ ...base, tipo: 'put' })
    expect(call.premio).toBeCloseTo(put.premio, 10)
    expect(call.gregas.deltaForward).toBeGreaterThan(0.45)
    expect(put.gregas.deltaForward).toBeLessThan(-0.4)
  })

  it('MtM de posição vendida tem sinal negativo e P&L vs prêmio', () => {
    const r = mtmOpcaoMoeda(
      { tipo: 'call', forward: 5.7, strike: 5.5, volAA: 15, du: 126, taxaDesconto: 11 },
      { posicao: 'vendida', montante: 1_000_000, premioContratado: 0.3 },
    )
    expect(r.valorPosicao).toBeCloseTo(-1_000_000 * r.premio, 6)
    expect(r.resultadoVsPremio).toBeCloseTo(-1_000_000 * (r.premio - 0.3), 6)
  })
})

// ========== MtM (NDF e swap) ==========

describe('MtM de NDF e swap', () => {
  const pre = curvaFlat('PRE', '2026-08-26', 12)
  const ptx = curvaFlat('PTX', '2026-08-26', 0) // será sobrescrito por curva de preço

  it('NDF com taxa contratada igual ao forward tem MtM zero', () => {
    const fwd = buildInterpolator('PTX', '2026-08-26', [
      { days: 1, rate: 5.6 },
      { days: 5000, rate: 5.6 },
    ])
    const r = calcularNDF(
      {
        montante: 1_000_000,
        posicao: 'comprada',
        dataMtM: '2026-08-26',
        dataVencimento: '2027-02-26',
        taxaContrato: r0(fwd.atCalendarDays(184)),
      },
      fwd,
      pre,
    )
    expect(Math.abs(r.mtmFinal)).toBeLessThan(1e-6)
  })

  it('NDF comprada ganha quando o forward sobe acima do contratado', () => {
    const fwd = buildInterpolator('PTX', '2026-08-26', [
      { days: 1, rate: 5.8 },
      { days: 5000, rate: 5.8 },
    ])
    const r = calcularNDF(
      {
        montante: 1_000_000,
        posicao: 'comprada',
        dataMtM: '2026-08-26',
        dataVencimento: '2027-02-26',
        taxaContrato: 5.5,
      },
      fwd,
      pre,
    )
    expect(r.mtmFinal).toBeGreaterThan(0)
    // MtM = M·(F−K)/df
    expect(r.mtmFinal).toBeCloseTo((1_000_000 * (r.forward - 5.5)) / r.fatorDesconto, 6)
  })

  it('swap pré × pré com a mesma taxa tem MtM zero', () => {
    const r = calcularSwapMtM(
      {
        valorNocional: 10_000_000,
        pernaAtiva: { tipo: 'pre', taxa: 12.5 },
        pernaPassiva: { tipo: 'pre', taxa: 12.5 },
        dataContratacao: '2025-08-26',
        dataVencimento: '2027-08-26',
        dataMtM: '2026-08-26',
      },
      pre,
    )
    expect(Math.abs(r.mtmFinal)).toBeLessThan(1e-6)
  })

  it('perna CDI vale VN × fator acumulado (projeção e desconto se cancelam)', () => {
    const r = calcularSwapMtM(
      {
        valorNocional: 1_000_000,
        pernaAtiva: { tipo: 'cdi', taxa: 0, percentualIndexador: 100 },
        pernaPassiva: { tipo: 'pre', taxa: 0 },
        dataContratacao: '2025-08-26',
        dataVencimento: '2027-08-26',
        dataMtM: '2026-08-26',
        fatorCDIAcumulado: 1.1,
      },
      pre,
    )
    expect(r.ativa.valorPresente).toBeCloseTo(1_100_000, 6)
  })

  it('truncar corta sem arredondar', () => {
    expect(truncar(1.999999999999, 6)).toBeCloseTo(1.999999, 12)
    expect(truncar(1.0000019, 6)).toBeCloseTo(1.000001, 12)
  })

  it('duEntreDatas conta dias úteis ANBIMA', () => {
    // 2026-08-21 (sex) → 2026-08-24 (seg): 1 dia útil
    expect(duEntreDatas('2026-08-21', '2026-08-24')).toBe(1)
  })

  void ptx
})

// ========== Empréstimos ==========

describe('simulador de empréstimos', () => {
  const base: ParametrosEmprestimo = {
    nome: 'Teste',
    principal: 1_000_000,
    dataDesembolso: '2026-01-05',
    prazoMeses: 12,
    periodicidade: 'mensal',
    sistema: 'price',
    indexador: 'pre',
    taxaAA: 15,
  }

  it('bullet prefixado: juros pagos por período sobre saldo constante e principal no fim', () => {
    const r = simularEmprestimo({ ...base, sistema: 'bullet' })
    const ultima = r.parcelas[r.parcelas.length - 1]
    expect(ultima.amortizacao).toBeCloseTo(1_000_000, 6)
    for (const p of r.parcelas.slice(0, -1)) {
      expect(p.amortizacao).toBe(0)
      expect(p.prestacao).toBeCloseTo(p.juros, 10)
      expect(p.saldoFinal).toBeCloseTo(1_000_000, 6)
    }
    const jurosEsperados = r.parcelas.reduce(
      (s, p) => s + 1_000_000 * ((1 + 0.15) ** (p.du / 252) - 1),
      0,
    )
    expect(r.totalJuros).toBeCloseTo(jurosEsperados, 4)
  })

  it('SAC amortiza o principal por igual e zera o saldo', () => {
    const r = simularEmprestimo({ ...base, sistema: 'sac' })
    expect(r.parcelas[0].amortizacao).toBeCloseTo(1_000_000 / 12, 6)
    expect(r.parcelas[r.parcelas.length - 1].saldoFinal).toBeCloseTo(0, 6)
    expect(r.totalAmortizacao).toBeCloseTo(1_000_000, 4)
  })

  it('CET sem despesas fica próximo da taxa contratada; com TAC fica acima', () => {
    const sem = simularEmprestimo(base)
    const com = simularEmprestimo({ ...base, despesas: { tacPercentual: 2, iofPessoa: null } })
    expect(sem.cetAA).not.toBeNull()
    expect(Math.abs((sem.cetAA as number) - 15)).toBeLessThan(1) // convenção dc/365 vs du/252
    expect((com.cetAA as number)).toBeGreaterThan(sem.cetAA as number)
    expect(com.liquidoLiberado).toBeCloseTo(1_000_000 * 0.98, 6)
  })

  it('IOF de crédito entra nas despesas e reduz o líquido liberado', () => {
    const r = simularEmprestimo({ ...base, despesas: { iofPessoa: 'pj' } })
    expect(r.despesas.iof).not.toBeNull()
    expect(r.liquidoLiberado).toBeCloseTo(1_000_000 - (r.despesas.iof?.total ?? 0), 6)
  })

  it('CDI projetado pela curva PRE flat reproduz a taxa da curva', () => {
    const curva = curvaFlat('PRE', '2026-01-05', 13)
    const r = simularEmprestimo({ ...base, indexador: 'cdi-spread', taxaAA: 0 }, curva)
    for (const p of r.parcelas) expect(p.taxaPeriodoAA).toBeCloseTo(13, 1)
  })

  it('resolverTaxaAnual: fluxo único de 110 em 365 dias sobre 100 → 10% a.a.', () => {
    const i = resolverTaxaAnual([{ dc: 365, valor: 110 }], 100)
    expect(i).toBeCloseTo(10, 4)
  })

  it('comparação aponta o contrato de menor CET', () => {
    const a = simularEmprestimo({ ...base, taxaAA: 14 })
    const b = simularEmprestimo({ ...base, taxaAA: 16 })
    const comp = compararEmprestimos(a, b)
    expect(comp.maisVantajoso).toBe('A')
    expect(comp.deltaTotalPago).toBeLessThan(0)
  })
})

/** Arredonda para reutilizar o forward interpolado como taxa contratada. */
function r0(v: number): number {
  return v
}
