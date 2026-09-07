/**
 * Opções de moeda OTC — apreçamento pelo modelo de Black (1976) sobre o
 * forward, a convenção usual do mercado brasileiro para opções de dólar
 * (equivalente a Garman–Kohlhagen quando F = S·e^{(rd−rf)T}):
 *
 *   call = df · [F·N(d1) − K·N(d2)]      put = df · [K·N(−d2) − F·N(−d1)]
 *   d1 = [ln(F/K) + σ²T/2] / (σ√T)       d2 = d1 − σ√T
 *
 * com F vindo da curva de PREÇO da B3 (PTX Real x dólar, EUR, JPY — Manual
 * §4.1–4.3), df = (1 + pré)^(−du/252) da curva PRE e T = du/252 (a vol de
 * moeda no Brasil é cotada em base 252 dias úteis).
 */

export type TipoOpcao = 'call' | 'put'

/** Densidade normal padrão. */
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

/** N(x) — CDF normal padrão (Abramowitz–Stegun 26.2.17, erro < 7,5e-8). */
export function normCdf(x: number): number {
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.2316419 * ax)
  const poly =
    t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  const tail = normPdf(ax) * poly
  return x >= 0 ? 1 - tail : tail
}

export interface ParametrosBlack {
  tipo: TipoOpcao
  /** Forward da moeda no vencimento (R$ por unidade da moeda). */
  forward: number
  /** Strike (R$ por unidade da moeda). */
  strike: number
  /** Volatilidade implícita, % a.a. (base 252 du). */
  volAA: number
  /** Dias úteis até o vencimento. */
  du: number
  /** Taxa pré de desconto, % a.a. base 252 (curva PRE no prazo). */
  taxaDesconto: number
}

export interface ResultadoBlack {
  tipo: TipoOpcao
  T: number
  d1: number
  d2: number
  nd1: number
  nd2: number
  fatorDesconto: number
  /** Prêmio unitário (R$ por unidade da moeda). */
  premio: number
  /** Valor intrínseco descontado (R$ por unidade). */
  intrinseco: number
  /** Valor no tempo (R$ por unidade). */
  valorTempo: number
  gregas: {
    /** ∂V/∂F (delta a termo). */
    deltaForward: number
    /** ∂²V/∂F² . */
    gamma: number
    /** ∂V/∂σ por ponto percentual de vol. */
    vega: number
    /** Decaimento por dia útil (θ/252), mantendo F e σ. */
    thetaDiaUtil: number
  }
}

export function precificarOpcaoBlack(p: ParametrosBlack): ResultadoBlack {
  if (p.forward <= 0 || p.strike <= 0) throw new Error('Forward e strike devem ser positivos.')
  if (p.du <= 0) throw new Error('A opção precisa de prazo positivo (du > 0).')
  if (p.volAA <= 0) throw new Error('Volatilidade deve ser positiva.')

  const T = p.du / 252
  const sigma = p.volAA / 100
  const vSqrtT = sigma * Math.sqrt(T)
  const df = (1 + p.taxaDesconto / 100) ** (-p.du / 252)

  const d1 = (Math.log(p.forward / p.strike) + 0.5 * vSqrtT * vSqrtT) / vSqrtT
  const d2 = d1 - vSqrtT

  const nd1 = normCdf(d1)
  const nd2 = normCdf(d2)

  const premio =
    p.tipo === 'call'
      ? df * (p.forward * nd1 - p.strike * nd2)
      : df * (p.strike * normCdf(-d2) - p.forward * normCdf(-d1))

  const intrinseco =
    df * Math.max(0, p.tipo === 'call' ? p.forward - p.strike : p.strike - p.forward)

  const deltaForward = p.tipo === 'call' ? df * nd1 : -df * normCdf(-d1)
  const gamma = (df * normPdf(d1)) / (p.forward * vSqrtT)
  const vega = (df * p.forward * normPdf(d1) * Math.sqrt(T)) / 100

  // Theta por dia útil: derivada numérica central é dispensável — usa a forma
  // fechada de Black no forward (sem carrego do subjacente):
  //   θ = −df·F·φ(d1)·σ/(2√T) ± r·V  (aprox.; reportamos por DU)
  const r = Math.log(1 + p.taxaDesconto / 100)
  const thetaAno = -((df * p.forward * normPdf(d1) * sigma) / (2 * Math.sqrt(T))) + r * premio
  const thetaDiaUtil = thetaAno / 252

  return {
    tipo: p.tipo,
    T,
    d1,
    d2,
    nd1,
    nd2,
    fatorDesconto: df,
    premio,
    intrinseco,
    valorTempo: premio - intrinseco,
    gregas: { deltaForward, gamma, vega, thetaDiaUtil },
  }
}

export interface PosicaoOpcao {
  /** 'comprada' recebe o valor da opção; 'vendida' deve o valor. */
  posicao: 'comprada' | 'vendida'
  /** Nocional em moeda estrangeira. */
  montante: number
  /** Prêmio unitário pago/recebido na contratação (opcional, para P&L). */
  premioContratado?: number
}

export interface MtMOpcao extends ResultadoBlack {
  /** Valor de mercado da posição em R$ (com sinal da ponta). */
  valorPosicao: number
  /** Resultado vs. prêmio da contratação (quando informado). */
  resultadoVsPremio: number | null
}

/** MtM de uma posição de opção de moeda OTC. */
export function mtmOpcaoMoeda(black: ParametrosBlack, posicao: PosicaoOpcao): MtMOpcao {
  const res = precificarOpcaoBlack(black)
  const sinal = posicao.posicao === 'comprada' ? 1 : -1
  const valorPosicao = sinal * posicao.montante * res.premio
  const resultadoVsPremio =
    posicao.premioContratado !== undefined
      ? sinal * posicao.montante * (res.premio - posicao.premioContratado)
      : null
  return { ...res, valorPosicao, resultadoVsPremio }
}
