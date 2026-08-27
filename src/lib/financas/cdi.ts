/**
 * Correção de valores pelo CDI — mesma metodologia da Calculadora do Cidadão /
 * calculadoras de contratos remunerados por CDI:
 *
 * - Série 4389 do BCB: DI/CDI anualizado base 252 dias úteis (% a.a.);
 * - Fator diário: (1 + CDI·p/100 / 100)^(1/252), com o percentual `p` aplicado
 *   sobre a TAXA anual (convenção "percentual do CDI");
 * - Spread opcional em % a.a., nas bases DU/252 (exponencial), DC/360 ou
 *   DC/365 (lineares) — ou "sobre-di", aplicado sobre o valor já corrigido;
 * - Alternativa de taxa prefixada mensal (correção linear pro-rata por mês).
 */

import { businessDaysForCalendarDays, calendarDaysBetween } from '../curves/calendar'

export interface PontoCDI {
  /** Data ISO (AAAA-MM-DD). */
  date: string
  /** CDI anualizado % a.a. (base 252). */
  rate: number
}

export type BaseSpread = 'DU/252' | 'DC/360' | 'DC/365' | 'sobre-di'

export interface MemoriaCDI {
  date: string
  taxaCDI: number
  taxaDiaria: number
  fatorDiario: number
  fatorAcumulado: number
  valorCorrigido: number
}

export interface ResultadoCorrecaoCDI {
  valorInicial: number
  valorCorrigidoCDI: number
  jurosSpread: number
  valorFinal: number
  fatorCDI: number
  taxaMediaCDI: number
  diasUteis: number
  diasCorridos: number
  memoria: MemoriaCDI[]
}

/**
 * Corrige `valorInicial` pela série diária do CDI entre as datas dos pontos
 * fornecidos, com percentual do CDI e spread opcional.
 */
export function corrigirPorCDI(
  valorInicial: number,
  serie: PontoCDI[],
  opts: {
    percentualCDI?: number // ex.: 100, 109.5
    spreadAA?: number // % a.a.
    baseSpread?: BaseSpread
    dataInicial: string
    dataFinal: string
  },
): ResultadoCorrecaoCDI {
  const p = (opts.percentualCDI ?? 100) / 100
  const memoria: MemoriaCDI[] = []

  let fator = 1
  let somaTaxas = 0
  let n = 0
  for (const ponto of serie) {
    const taxaAplicada = ponto.rate * p
    const taxaDiaria = (1 + taxaAplicada / 100) ** (1 / 252) - 1
    const fatorDiario = 1 + taxaDiaria
    fator *= fatorDiario
    somaTaxas += ponto.rate
    n++
    memoria.push({
      date: ponto.date,
      taxaCDI: ponto.rate,
      taxaDiaria: taxaDiaria * 100,
      fatorDiario,
      fatorAcumulado: fator,
      valorCorrigido: valorInicial * fator,
    })
  }

  const valorCorrigidoCDI = valorInicial * fator
  const dc = calendarDaysBetween(opts.dataInicial, opts.dataFinal)
  const du = businessDaysForCalendarDays(opts.dataInicial, dc)

  let jurosSpread = 0
  const spread = opts.spreadAA ?? 0
  if (spread > 0) {
    const base = opts.baseSpread ?? 'DU/252'
    if (base === 'DU/252') {
      jurosSpread = valorInicial * ((1 + spread / 100) ** (du / 252) - 1)
    } else if (base === 'DC/360') {
      jurosSpread = valorInicial * (spread / 100) * (dc / 360)
    } else if (base === 'DC/365') {
      jurosSpread = valorInicial * (spread / 100) * (dc / 365)
    } else {
      // sobre-di: exponencial DU/252 aplicado sobre o valor já corrigido
      jurosSpread = valorCorrigidoCDI * ((1 + spread / 100) ** (du / 252) - 1)
    }
  }

  return {
    valorInicial,
    valorCorrigidoCDI,
    jurosSpread,
    valorFinal: valorCorrigidoCDI + jurosSpread,
    fatorCDI: fator,
    taxaMediaCDI: n > 0 ? somaTaxas / n : 0,
    diasUteis: du,
    diasCorridos: dc,
    memoria,
  }
}

export interface MemoriaTaxaFixa {
  mes: number
  taxa: number
  fator: number
  valorCorrigido: number
}

/** Correção por taxa prefixada mensal (meses cheios + pro-rata linear). */
export function corrigirPorTaxaFixaMensal(
  valorInicial: number,
  taxaMensal: number,
  dataInicial: string,
  dataFinal: string,
): { valorFinal: number; memoria: MemoriaTaxaFixa[] } {
  const dias = calendarDaysBetween(dataInicial, dataFinal)
  const meses = Math.floor(dias / 30)
  const diasRestantes = dias % 30

  const memoria: MemoriaTaxaFixa[] = []
  let valor = valorInicial
  for (let i = 1; i <= meses; i++) {
    const fator = 1 + taxaMensal / 100
    valor *= fator
    memoria.push({ mes: i, taxa: taxaMensal, fator, valorCorrigido: valor })
  }
  if (diasRestantes > 0) {
    const taxaProporcional = (taxaMensal * diasRestantes) / 30
    const fator = 1 + taxaProporcional / 100
    valor *= fator
    memoria.push({ mes: meses + diasRestantes / 30, taxa: taxaProporcional, fator, valorCorrigido: valor })
  }
  return { valorFinal: valor, memoria }
}

/**
 * Fator CDI acumulado entre duas datas dentro de uma série — convenção do
 * fator DI: produto das taxas dos dias úteis em [dataInicial, dataFinal), ou
 * seja, a taxa do próprio dia inicial entra e a do dia final não (o CDI de um
 * dia remunera do dia para o seguinte). Percentual aplicado sobre a taxa.
 * Usado pelo MtM de swap (perna CDI) e pela correção até uma data.
 */
export function fatorCDIEntre(
  serie: PontoCDI[],
  dataInicial: string,
  dataFinal: string,
  percentualCDI = 100,
): number {
  const p = percentualCDI / 100
  let fator = 1
  for (const ponto of serie) {
    if (ponto.date >= dataInicial && ponto.date < dataFinal) {
      fator *= (1 + (ponto.rate * p) / 100) ** (1 / 252)
    }
  }
  return fator
}
