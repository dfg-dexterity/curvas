/**
 * Marcação a mercado (MtM) de NDF e swaps com as curvas do próprio banco:
 *
 * NDF: MtM = ±M · (F − K) / fator_desconto, com o forward F interpolado da
 * curva de PREÇO da moeda (PTX/EUR/JPY — Manual §4.1–4.3) e o desconto pela
 * curva PRE, fator (1+i)^(du/252) truncado na 12ª casa (prática de mercado).
 *
 * Swap: MtM = VP(perna ativa) − VP(perna passiva), cada perna projetada até o
 * vencimento e descontada pela curva PRE:
 *  - CDI/Selic: VP = VN · fator_CDI_acumulado(contratação→MtM) — o fator
 *    projetado até o vencimento cancela com o desconto na própria curva —
 *    com % do indexador sobre a taxa e spread exponencial 252 opcional;
 *  - Pré: VF = VN · (1+taxa)^(DU_total/252);
 *  - IPCA + spread: VF = VN · (1+taxa_total_projetada)^(DU_total/252);
 *  - Dólar + cupom: VF = VN · (PTAX_MtM/PTAX_inicial) · (1 + cupom·DC_total/360)
 *    (cupom cambial em convenção linear 360).
 */

import { businessDaysForCalendarDays, calendarDaysBetween } from '../curves/calendar'
import type { CurveInterpolator } from '../curves/interpolation'

/** Trunca em `casas` decimais (TRUNC do Excel). */
export function truncar(valor: number, casas: number): number {
  const f = 10 ** casas
  return Math.trunc(valor * f) / f
}

/** DU entre duas datas ISO (exclusivo início, inclusivo fim — ANBIMA). */
export function duEntreDatas(fromISO: string, toISO: string): number {
  return businessDaysForCalendarDays(fromISO, calendarDaysBetween(fromISO, toISO))
}

// ========== NDF ==========

export interface ParametrosNDF {
  montante: number // nocional em moeda estrangeira
  posicao: 'comprada' | 'vendida'
  dataMtM: string // AAAA-MM-DD (data-base das curvas)
  dataVencimento: string
  taxaContrato: number // termo contratado (R$ por unidade da moeda)
}

export interface ResultadoNDF {
  dc: number
  du: number
  forward: number // forward interpolado da curva de preço
  taxaDesconto: number // % a.a. PRE no prazo
  fatorDesconto: number
  diferencaCambial: number
  mtmBruto: number
  mtmFinal: number
}

/**
 * MtM de NDF usando o forward da curva de preço da moeda e o desconto PRE.
 * `curvaMoeda` deve ser o interpolador da curva de preço (PTX/EUR/JPY) e
 * `curvaPre` o da curva PRE, ambos na data de MtM.
 */
export function calcularNDF(
  params: ParametrosNDF,
  curvaMoeda: CurveInterpolator,
  curvaPre: CurveInterpolator,
): ResultadoNDF {
  const dc = calendarDaysBetween(params.dataMtM, params.dataVencimento)
  if (dc <= 0) throw new Error('O vencimento deve ser posterior à data de MtM.')
  const du = businessDaysForCalendarDays(params.dataMtM, dc)
  if (du <= 0) throw new Error('Sem dias úteis entre a data de MtM e o vencimento.')

  const forward = curvaMoeda.atCalendarDays(dc)
  const taxaDesconto = curvaPre.atCalendarDays(dc)
  const fatorDesconto = truncar((1 + taxaDesconto / 100) ** (du / 252), 12)

  const diferencaCambial = forward - params.taxaContrato
  const mtmBruto = params.montante * diferencaCambial
  const sinal = params.posicao === 'comprada' ? 1 : -1
  const mtmFinal = (sinal * mtmBruto) / fatorDesconto

  return {
    dc,
    du,
    forward,
    taxaDesconto,
    fatorDesconto,
    diferencaCambial,
    mtmBruto,
    mtmFinal,
  }
}

// ========== Swap ==========

export type TipoPernaSwap = 'cdi' | 'selic' | 'pre' | 'ipca' | 'dolar'

export interface PernaSwap {
  tipo: TipoPernaSwap
  /** Taxa fixa, spread ou cupom, % a.a. conforme o tipo. */
  taxa: number
  /** % do indexador (CDI/Selic), ex.: 100, 98. */
  percentualIndexador?: number
}

export interface ParametrosSwap {
  valorNocional: number
  pernaAtiva: PernaSwap
  pernaPassiva: PernaSwap
  dataContratacao: string
  dataVencimento: string
  dataMtM: string
  /** Fator CDI/Selic acumulado da contratação até o MtM (com % aplicado). */
  fatorCDIAcumulado?: number
  ptaxInicial?: number
  ptaxMtM?: number
}

export interface ResultadoPernaSwap {
  valorFuturo: number
  valorPresente: number
  detalhe: string
}

export interface ResultadoSwap {
  duTotal: number
  duDecorrido: number
  duRestante: number
  dcTotal: number
  dcRestante: number
  taxaDesconto: number
  fatorDesconto: number
  ativa: ResultadoPernaSwap
  passiva: ResultadoPernaSwap
  mtmFinal: number
}

function calcularPerna(
  perna: PernaSwap,
  p: ParametrosSwap,
  duTotal: number,
  duDecorrido: number,
  dcTotal: number,
  fatorDesconto: number,
): ResultadoPernaSwap {
  const VN = p.valorNocional
  const pct = perna.percentualIndexador ?? 100

  switch (perna.tipo) {
    case 'cdi':
    case 'selic': {
      // VP = VN · fator acumulado até o MtM (projeção × desconto cancelam)
      const fator =
        p.fatorCDIAcumulado ?? (1 + (perna.taxa * (pct / 100)) / 100) ** (duDecorrido / 252)
      const fatorSpread =
        perna.taxa > 0 && p.fatorCDIAcumulado !== undefined
          ? (1 + perna.taxa / 100) ** (duDecorrido / 252)
          : 1
      const vp = VN * fator * fatorSpread
      return {
        valorFuturo: vp * fatorDesconto,
        valorPresente: vp,
        detalhe: `${pct}% ${perna.tipo === 'cdi' ? 'CDI' : 'Selic'}${perna.taxa > 0 && p.fatorCDIAcumulado !== undefined ? ` + ${perna.taxa}% a.a.` : ''} · fator acumulado ${(fator * fatorSpread).toFixed(8)}`,
      }
    }
    case 'pre': {
      const fator = (1 + perna.taxa / 100) ** (duTotal / 252)
      const vf = VN * fator
      return {
        valorFuturo: vf,
        valorPresente: vf / fatorDesconto,
        detalhe: `Pré ${perna.taxa}% a.a. · fator ${fator.toFixed(8)} · ${duTotal} du`,
      }
    }
    case 'ipca': {
      const fator = (1 + perna.taxa / 100) ** (duTotal / 252)
      const vf = VN * fator
      return {
        valorFuturo: vf,
        valorPresente: vf / fatorDesconto,
        detalhe: `IPCA + spread (taxa total projetada ${perna.taxa}% a.a.) · fator ${fator.toFixed(8)}`,
      }
    }
    case 'dolar': {
      const varCambial = p.ptaxMtM && p.ptaxInicial ? p.ptaxMtM / p.ptaxInicial : 1
      const fatorCupom = 1 + (perna.taxa / 100) * (dcTotal / 360)
      const vf = VN * varCambial * fatorCupom
      return {
        valorFuturo: vf,
        valorPresente: vf / fatorDesconto,
        detalhe: `Dólar + cupom ${perna.taxa}% a.a. (linear 360) · variação cambial ${((varCambial - 1) * 100).toFixed(4)}%`,
      }
    }
  }
}

/** MtM de swap descontado pela curva PRE na data de MtM. */
export function calcularSwapMtM(params: ParametrosSwap, curvaPre: CurveInterpolator): ResultadoSwap {
  const dcTotal = calendarDaysBetween(params.dataContratacao, params.dataVencimento)
  const dcRestante = calendarDaysBetween(params.dataMtM, params.dataVencimento)
  if (dcRestante <= 0) throw new Error('O vencimento deve ser posterior à data de MtM.')

  const duTotal = businessDaysForCalendarDays(params.dataContratacao, dcTotal)
  const duDecorrido = duEntreDatas(params.dataContratacao, params.dataMtM)
  const duRestante = businessDaysForCalendarDays(params.dataMtM, dcRestante)

  const taxaDesconto = curvaPre.atCalendarDays(dcRestante)
  const fatorDesconto = (1 + taxaDesconto / 100) ** (duRestante / 252)

  const ativa = calcularPerna(params.pernaAtiva, params, duTotal, duDecorrido, dcTotal, fatorDesconto)
  const passiva = calcularPerna(
    params.pernaPassiva,
    params,
    duTotal,
    duDecorrido,
    dcTotal,
    fatorDesconto,
  )

  return {
    duTotal,
    duDecorrido,
    duRestante,
    dcTotal,
    dcRestante,
    taxaDesconto,
    fatorDesconto,
    ativa,
    passiva,
    mtmFinal: ativa.valorPresente - passiva.valorPresente,
  }
}

/** Curva de preço (forward) da moeda para cada moeda suportada. */
export const CURVA_FORWARD_MOEDA: Record<string, string> = {
  USD: 'PTX',
  EUR: 'EUR',
  JPY: 'JPY',
}
