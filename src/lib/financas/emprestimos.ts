/**
 * Simulador de empréstimos com fluxo de caixa em datas reais (calendário
 * ANBIMA), indexadores pós-fixados projetados pela PRÓPRIA curva PRE do banco
 * (fatores a termo, em vez de um "CDI projetado" chutado), despesas de
 * captação (IOF de crédito, TAC/estruturação e outras) e CET — o Custo
 * Efetivo Total na convenção do BCB (Resolução 3.517: taxa anual que iguala o
 * valor LÍQUIDO liberado ao valor presente das prestações, expoente dc/365).
 *
 * A comparação entre dois contratos usa o CET, o total pago e o custo a valor
 * presente descontado na curva PRE da data da simulação.
 */

import { businessDaysForCalendarDays, calendarDaysBetween, isBusinessDayBR } from '../curves/calendar'
import type { CurveInterpolator } from '../curves/interpolation'
import { calcularIOFCredito, type PessoaIOF, type ResultadoIOFCredito } from './impostos'

export type IndexadorEmprestimo = 'pre' | 'cdi-spread' | 'percentual-cdi' | 'ipca-spread'
export type SistemaAmortizacao = 'sac' | 'price' | 'bullet'
export type Periodicidade = 'mensal' | 'trimestral' | 'semestral' | 'anual'
export type BaseCalculoPre = '252' | '360' | '365'

export const MESES_POR_PERIODO: Record<Periodicidade, number> = {
  mensal: 1,
  trimestral: 3,
  semestral: 6,
  anual: 12,
}

export interface DespesasCaptacao {
  /** Calcula IOF de crédito automaticamente sobre o fluxo (PF ou PJ). */
  iofPessoa?: PessoaIOF | null
  /** Tarifa de abertura/estruturação, % sobre o principal. */
  tacPercentual?: number
  /** Tarifa de abertura/estruturação, valor fixo em R$. */
  tacValor?: number
  /** Outras despesas na liberação (cartório, avaliação, seguros…), R$. */
  outrasDespesas?: number
}

export interface ParametrosEmprestimo {
  nome?: string
  principal: number
  dataDesembolso: string // AAAA-MM-DD
  prazoMeses: number
  carenciaMeses?: number
  /** true: juros da carência capitalizam no saldo; false: são pagos. */
  carenciaCapitaliza?: boolean
  periodicidade: Periodicidade
  sistema: SistemaAmortizacao
  indexador: IndexadorEmprestimo
  /** Pré: taxa cheia % a.a.; cdi-spread e ipca-spread: spread % a.a. */
  taxaAA?: number
  /** percentual-cdi: % do CDI (ex.: 110). */
  percentualCDI?: number
  /** Base de cálculo da taxa pré ('252' exponencial; '360'/'365' linear). */
  baseCalculoPre?: BaseCalculoPre
  /** Fallback de CDI projetado % a.a. quando não houver curva PRE. */
  cdiProjetadoAA?: number
  /** IPCA projetado % a.a. (ipca-spread). */
  ipcaProjetadoAA?: number
  despesas?: DespesasCaptacao
}

export interface ParcelaEmprestimo {
  numero: number
  data: string
  dc: number // dias corridos do período
  du: number // dias úteis do período
  dcAcumulado: number // dias corridos desde o desembolso
  duAcumulado: number // dias úteis desde o desembolso
  taxaPeriodoAA: number // taxa anualizada efetivamente usada no período (% a.a.)
  saldoInicial: number
  juros: number
  amortizacao: number
  prestacao: number
  saldoFinal: number
  carencia: boolean
}

export interface ResultadoEmprestimo {
  parametros: ParametrosEmprestimo
  parcelas: ParcelaEmprestimo[]
  principal: number
  despesas: {
    iof: ResultadoIOFCredito | null
    tac: number
    outras: number
    total: number
  }
  liquidoLiberado: number
  totalJuros: number
  totalAmortizacao: number
  totalPago: number
  /** CET % a.a. (convenção BCB, expoente dc/365) sobre o líquido liberado. */
  cetAA: number | null
  /** Taxa interna % a.a. SEM despesas (sobre o principal) — para isolar o efeito delas. */
  taxaEfetivaSemDespesasAA: number | null
  /** Valor presente das prestações descontadas na curva PRE (quando fornecida). */
  vpPrestacoesCurva: number | null
  /** Custo a valor presente: VP das prestações − líquido liberado. */
  custoVPCurva: number | null
  avisos: string[]
}

// ========== Datas ==========

function toISO(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const alvoMes = m - 1 + months
  const ultimoDia = new Date(Date.UTC(y, alvoMes + 1, 0)).getUTCDate()
  return toISO(new Date(Date.UTC(y, alvoMes, Math.min(d, ultimoDia))))
}

function proximoDiaUtilISO(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  let data = new Date(Date.UTC(y, m - 1, d))
  while (!isBusinessDayBR(data)) data = new Date(data.getTime() + 86_400_000)
  return toISO(data)
}

// ========== Fatores por período ==========

interface FatorPeriodo {
  fator: number
  taxaAA: number
}

/**
 * Fator do indexador em um período [duIni, duFim] (DU acumulados desde o
 * desembolso), usando a curva PRE como estrutura a termo do CDI quando
 * disponível: fator forward = fPRE(duFim)/fPRE(duIni).
 */
function fatorIndexadorPeriodo(
  params: ParametrosEmprestimo,
  curvaPre: CurveInterpolator | null,
  dcIni: number,
  dcFim: number,
  duIni: number,
  duFim: number,
  avisos: string[],
  avisou: { semCurva: boolean },
): FatorPeriodo {
  const duPer = Math.max(1, duFim - duIni)
  const dcPer = Math.max(1, dcFim - dcIni)
  const taxa = params.taxaAA ?? 0

  if (params.indexador === 'pre') {
    const base = params.baseCalculoPre ?? '252'
    if (base === '252') return { fator: (1 + taxa / 100) ** (duPer / 252), taxaAA: taxa }
    const dias = base === '360' ? 360 : 365
    return { fator: 1 + (taxa / 100) * (dcPer / dias), taxaAA: taxa }
  }

  if (params.indexador === 'ipca-spread') {
    const ipca = params.ipcaProjetadoAA ?? 0
    const fator = ((1 + ipca / 100) * (1 + taxa / 100)) ** (duPer / 252)
    return { fator, taxaAA: ((1 + ipca / 100) * (1 + taxa / 100) - 1) * 100 }
  }

  // CDI projetado: forward da curva PRE entre os dois prazos, ou fallback fixo
  let taxaFwdAA: number
  if (curvaPre && dcFim > 0) {
    const fFim = (1 + curvaPre.atCalendarDays(dcFim) / 100) ** (duFim / 252)
    const fIni = dcIni > 0 ? (1 + curvaPre.atCalendarDays(dcIni) / 100) ** (duIni / 252) : 1
    const fFwd = fFim / fIni
    taxaFwdAA = (fFwd ** (252 / duPer) - 1) * 100
  } else {
    taxaFwdAA = params.cdiProjetadoAA ?? 0
    if (curvaPre === null && !avisou.semCurva) {
      avisos.push(
        `Curva PRE indisponível — CDI projetado fixo de ${taxaFwdAA.toFixed(2)}% a.a. em todos os períodos.`,
      )
      avisou.semCurva = true
    }
  }

  if (params.indexador === 'percentual-cdi') {
    const p = (params.percentualCDI ?? 100) / 100
    const taxaAplicada = taxaFwdAA * p
    return { fator: (1 + taxaAplicada / 100) ** (duPer / 252), taxaAA: taxaAplicada }
  }

  // cdi-spread
  const fator =
    (1 + taxaFwdAA / 100) ** (duPer / 252) * (1 + taxa / 100) ** (duPer / 252)
  const taxaTotal = ((1 + taxaFwdAA / 100) * (1 + taxa / 100) - 1) * 100
  return { fator, taxaAA: taxaTotal }
}

// ========== Geração do fluxo ==========

/**
 * Gera o fluxo completo do contrato. `curvaPre` (opcional) é o interpolador da
 * curva PRE na data da simulação, usado para projetar o CDI e para o custo a
 * valor presente.
 */
export function simularEmprestimo(
  params: ParametrosEmprestimo,
  curvaPre: CurveInterpolator | null = null,
): ResultadoEmprestimo {
  const avisos: string[] = []
  const avisou = { semCurva: false }
  const mesesPeriodo = MESES_POR_PERIODO[params.periodicidade]
  const totalPeriodos = Math.ceil(params.prazoMeses / mesesPeriodo)
  const periodosCarencia = Math.floor((params.carenciaMeses ?? 0) / mesesPeriodo)
  const periodosAmort = totalPeriodos - periodosCarencia
  if (totalPeriodos <= 0) throw new Error('Prazo total deve ser positivo.')
  if (periodosAmort <= 0) throw new Error('A carência deve ser menor que o prazo total.')

  // Datas de pagamento ajustadas ao dia útil seguinte
  const datas: string[] = []
  for (let k = 1; k <= totalPeriodos; k++) {
    datas.push(proximoDiaUtilISO(addMonthsISO(params.dataDesembolso, k * mesesPeriodo)))
  }

  // Fatores por período (dc/du acumulados desde o desembolso)
  const acum = datas.map((data) => {
    const dc = calendarDaysBetween(params.dataDesembolso, data)
    return { data, dc, du: businessDaysForCalendarDays(params.dataDesembolso, dc) }
  })

  const fatores: FatorPeriodo[] = acum.map((a, i) => {
    const prev = i === 0 ? { dc: 0, du: 0 } : acum[i - 1]
    return fatorIndexadorPeriodo(params, curvaPre, prev.dc, a.dc, prev.du, a.du, avisos, avisou)
  })

  // Saldo no início da amortização (carência capitalizada engorda o saldo)
  let saldoInicioAmort = params.principal
  if (params.carenciaCapitaliza && periodosCarencia > 0) {
    for (let k = 0; k < periodosCarencia; k++) saldoInicioAmort *= fatores[k].fator
  }

  // PMT do Price com a taxa média dos períodos de amortização
  let pmtPrice = 0
  if (params.sistema === 'price') {
    const fatoresAmort = fatores.slice(periodosCarencia)
    const taxaMedia =
      fatoresAmort.reduce((s, f) => s + (f.fator - 1), 0) / fatoresAmort.length
    pmtPrice =
      taxaMedia === 0
        ? saldoInicioAmort / periodosAmort
        : (saldoInicioAmort * (taxaMedia * (1 + taxaMedia) ** periodosAmort)) /
          ((1 + taxaMedia) ** periodosAmort - 1)
  }
  const amortSAC = saldoInicioAmort / periodosAmort

  const parcelas: ParcelaEmprestimo[] = []
  let saldo = params.principal
  let totalJuros = 0
  let totalAmortizacao = 0
  let totalPago = 0

  for (let k = 0; k < totalPeriodos; k++) {
    const { data, dc, du } = acum[k]
    const prev = k === 0 ? { dc: 0, du: 0 } : acum[k - 1]
    const juros = saldo * (fatores[k].fator - 1)
    const emCarencia = k < periodosCarencia
    const ultima = k === totalPeriodos - 1

    let amortizacao = 0
    let prestacao = 0
    const saldoInicial = saldo

    if (emCarencia) {
      if (params.carenciaCapitaliza) {
        saldo += juros
      } else {
        prestacao = juros
      }
    } else {
      switch (params.sistema) {
        case 'sac':
          amortizacao = ultima ? saldo : Math.min(amortSAC, saldo)
          prestacao = juros + amortizacao
          break
        case 'price':
          if (ultima) {
            amortizacao = saldo
            prestacao = juros + amortizacao
          } else {
            prestacao = pmtPrice
            amortizacao = Math.min(Math.max(0, prestacao - juros), saldo)
          }
          break
        case 'bullet':
          amortizacao = ultima ? saldo : 0
          prestacao = juros + amortizacao
          break
      }
      saldo -= amortizacao
    }

    totalJuros += emCarencia && params.carenciaCapitaliza ? 0 : juros
    totalAmortizacao += amortizacao
    totalPago += prestacao

    parcelas.push({
      numero: k + 1,
      data,
      dc: dc - prev.dc,
      du: du - prev.du,
      dcAcumulado: dc,
      duAcumulado: du,
      taxaPeriodoAA: fatores[k].taxaAA,
      saldoInicial,
      juros,
      amortizacao,
      prestacao,
      saldoFinal: saldo,
      carencia: emCarencia,
    })
  }

  // ===== Despesas de captação =====
  const d = params.despesas ?? {}
  const iof = d.iofPessoa
    ? calcularIOFCredito(
        params.principal,
        parcelas
          .filter((p) => p.amortizacao > 0)
          .map((p) => ({ diasCorridos: p.dcAcumulado, amortizacao: p.amortizacao })),
        d.iofPessoa,
      )
    : null
  const tac = params.principal * ((d.tacPercentual ?? 0) / 100) + (d.tacValor ?? 0)
  const outras = d.outrasDespesas ?? 0
  const totalDespesas = (iof?.total ?? 0) + tac + outras
  const liquidoLiberado = params.principal - totalDespesas
  if (liquidoLiberado <= 0) avisos.push('Despesas de captação superam o principal — CET indefinido.')

  // ===== CET (dc/365, convenção BCB) e taxa efetiva sem despesas =====
  const fluxos = parcelas
    .filter((p) => p.prestacao > 0)
    .map((p) => ({ dc: p.dcAcumulado, valor: p.prestacao }))
  const cetAA = liquidoLiberado > 0 ? resolverTaxaAnual(fluxos, liquidoLiberado) : null
  const taxaEfetivaSemDespesasAA = resolverTaxaAnual(fluxos, params.principal)

  // ===== Custo a valor presente na curva PRE =====
  let vpPrestacoesCurva: number | null = null
  let custoVPCurva: number | null = null
  if (curvaPre) {
    let vp = 0
    for (const p of parcelas) {
      if (p.prestacao <= 0) continue
      const taxaDesc = curvaPre.atCalendarDays(p.dcAcumulado)
      vp += p.prestacao / (1 + taxaDesc / 100) ** (p.duAcumulado / 252)
    }
    vpPrestacoesCurva = vp
    custoVPCurva = vp - liquidoLiberado
  }

  return {
    parametros: params,
    parcelas,
    principal: params.principal,
    despesas: { iof, tac, outras, total: totalDespesas },
    liquidoLiberado,
    totalJuros,
    totalAmortizacao,
    totalPago,
    cetAA,
    taxaEfetivaSemDespesasAA,
    vpPrestacoesCurva,
    custoVPCurva,
    avisos,
  }
}

/**
 * Taxa anual i (expoente dc/365) que iguala Σ valor_k/(1+i)^(dc_k/365) ao
 * valor liberado — bisseção em [0%, 1000%] a.a.
 */
export function resolverTaxaAnual(
  fluxos: Array<{ dc: number; valor: number }>,
  valorLiberado: number,
): number | null {
  if (fluxos.length === 0 || valorLiberado <= 0) return null
  const vp = (i: number) =>
    fluxos.reduce((s, f) => s + f.valor / (1 + i) ** (f.dc / 365), 0)

  let lo = 0
  let hi = 10 // 1000% a.a.
  if (vp(lo) < valorLiberado) return 0 // sem juros (ou fluxo menor que o liberado)
  if (vp(hi) > valorLiberado) return null // acima do teto — não converge
  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2
    if (vp(mid) > valorLiberado) lo = mid
    else hi = mid
  }
  return ((lo + hi) / 2) * 100
}

// ========== Comparação de contratos ==========

export interface CriterioComparacao {
  criterio: string
  valorA: number | null
  valorB: number | null
  /** 'A' | 'B' | null (empate/indisponível) — menor valor vence. */
  melhor: 'A' | 'B' | null
}

export interface ComparacaoEmprestimos {
  criterios: CriterioComparacao[]
  /** Contrato mais vantajoso pelo CET (critério principal do BCB). */
  maisVantajoso: 'A' | 'B' | 'empate'
  deltaCET: number | null
  deltaTotalPago: number
  deltaCustoVP: number | null
}

export function compararEmprestimos(
  a: ResultadoEmprestimo,
  b: ResultadoEmprestimo,
): ComparacaoEmprestimos {
  const menor = (va: number | null, vb: number | null): 'A' | 'B' | null => {
    if (va === null || vb === null) return null
    if (Math.abs(va - vb) < 1e-9) return null
    return va < vb ? 'A' : 'B'
  }

  const criterios: CriterioComparacao[] = [
    { criterio: 'CET (% a.a.)', valorA: a.cetAA, valorB: b.cetAA, melhor: menor(a.cetAA, b.cetAA) },
    {
      criterio: 'Taxa efetiva sem despesas (% a.a.)',
      valorA: a.taxaEfetivaSemDespesasAA,
      valorB: b.taxaEfetivaSemDespesasAA,
      melhor: menor(a.taxaEfetivaSemDespesasAA, b.taxaEfetivaSemDespesasAA),
    },
    {
      criterio: 'Despesas de captação (R$)',
      valorA: a.despesas.total,
      valorB: b.despesas.total,
      melhor: menor(a.despesas.total, b.despesas.total),
    },
    {
      criterio: 'Total pago (R$)',
      valorA: a.totalPago,
      valorB: b.totalPago,
      melhor: menor(a.totalPago, b.totalPago),
    },
    {
      criterio: 'Juros totais (R$)',
      valorA: a.totalJuros,
      valorB: b.totalJuros,
      melhor: menor(a.totalJuros, b.totalJuros),
    },
    {
      criterio: 'Custo a valor presente na curva PRE (R$)',
      valorA: a.custoVPCurva,
      valorB: b.custoVPCurva,
      melhor: menor(a.custoVPCurva, b.custoVPCurva),
    },
  ]

  const porCET = menor(a.cetAA, b.cetAA)
  const porVP = menor(a.custoVPCurva, b.custoVPCurva)
  const maisVantajoso = porCET ?? porVP ?? 'empate'

  return {
    criterios,
    maisVantajoso,
    deltaCET: a.cetAA !== null && b.cetAA !== null ? a.cetAA - b.cetAA : null,
    deltaTotalPago: a.totalPago - b.totalPago,
    deltaCustoVP:
      a.custoVPCurva !== null && b.custoVPCurva !== null ? a.custoVPCurva - b.custoVPCurva : null,
  }
}
