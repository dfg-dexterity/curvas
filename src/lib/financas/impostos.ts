/**
 * Impostos sobre operações financeiras (legislação vigente):
 *
 * - IOF regressivo sobre RENDIMENTOS de renda fixa (Decreto 6.306/2007, Anexo):
 *   96% do rendimento no 1º dia corrido, decrescendo até 0% no 30º dia.
 * - IRRF regressivo sobre rendimentos (Lei 11.033/2004): 22,5% até 180 dias,
 *   20% até 360, 17,5% até 720 e 15% acima — sobre o rendimento líquido de IOF.
 * - IOF sobre operações de CRÉDITO (Decreto 6.306/2007, art. 7º): alíquota
 *   diária de 0,0041% (PJ) ou 0,0082% (PF), limitada a 365 dias, mais a
 *   alíquota adicional fixa de 0,38% sobre o principal.
 */

// ========== IOF regressivo sobre rendimentos ==========

const IOF_REGRESSIVO: number[] = [
  96, 93, 90, 86, 83, 80, 76, 73, 70, 66, 63, 60, 56, 53, 50, 46, 43, 40, 36,
  33, 30, 26, 23, 20, 16, 13, 10, 6, 3, 0,
]

/** Alíquota de IOF (%) sobre o rendimento, pelos dias corridos da aplicação. */
export function aliquotaIOFRendimento(diasCorridos: number): number {
  if (diasCorridos <= 0) return 96
  if (diasCorridos >= 30) return 0
  return IOF_REGRESSIVO[diasCorridos - 1]
}

/** Alíquota de IRRF (%) pela tabela regressiva de renda fixa. */
export function aliquotaIRRF(diasCorridos: number): number {
  if (diasCorridos <= 180) return 22.5
  if (diasCorridos <= 360) return 20
  if (diasCorridos <= 720) return 17.5
  return 15
}

export interface ResultadoImpostos {
  diasCorridos: number
  rendimentoBruto: number
  aliquotaIOF: number
  valorIOF: number
  rendimentoAposIOF: number
  aliquotaIRRF: number
  valorIRRF: number
  totalImpostos: number
  rendimentoLiquido: number
  valorFinalLiquido: number
}

/** IOF + IRRF sobre o rendimento de uma aplicação (IRRF após deduzir o IOF). */
export function calcularImpostosRendaFixa(
  valorInicial: number,
  valorFinalBruto: number,
  diasCorridos: number,
): ResultadoImpostos {
  const rendimentoBruto = valorFinalBruto - valorInicial
  const aliquotaIOF = aliquotaIOFRendimento(diasCorridos)
  const valorIOF = Math.max(0, rendimentoBruto) * (aliquotaIOF / 100)
  const rendimentoAposIOF = rendimentoBruto - valorIOF
  const irrf = aliquotaIRRF(diasCorridos)
  const valorIRRF = Math.max(0, rendimentoAposIOF) * (irrf / 100)
  const totalImpostos = valorIOF + valorIRRF
  const rendimentoLiquido = rendimentoBruto - totalImpostos
  return {
    diasCorridos,
    rendimentoBruto,
    aliquotaIOF,
    valorIOF,
    rendimentoAposIOF,
    aliquotaIRRF: irrf,
    valorIRRF,
    totalImpostos,
    rendimentoLiquido,
    valorFinalLiquido: valorInicial + rendimentoLiquido,
  }
}

// ========== IOF sobre operações de crédito ==========

export type PessoaIOF = 'pj' | 'pf'

/** Alíquota diária do IOF de crédito (% ao dia). */
export function aliquotaDiariaIOFCredito(pessoa: PessoaIOF): number {
  return pessoa === 'pf' ? 0.0082 : 0.0041
}

/** Alíquota adicional fixa do IOF de crédito (%). */
export const IOF_CREDITO_ADICIONAL = 0.38

export interface FluxoAmortizacao {
  /** Dias corridos entre o desembolso e o pagamento da amortização. */
  diasCorridos: number
  /** Valor de principal amortizado no fluxo. */
  amortizacao: number
}

export interface ResultadoIOFCredito {
  pessoa: PessoaIOF
  aliquotaDiaria: number
  iofDiario: number
  iofAdicional: number
  total: number
}

/**
 * IOF de crédito calculado por fluxo de amortização (método do Decreto
 * 6.306/2007: a alíquota diária incide sobre cada parcela de principal pelo
 * prazo até o pagamento, limitado a 365 dias; o adicional de 0,38% incide
 * sobre o principal total na liberação).
 */
export function calcularIOFCredito(
  principal: number,
  fluxos: FluxoAmortizacao[],
  pessoa: PessoaIOF,
): ResultadoIOFCredito {
  const diaria = aliquotaDiariaIOFCredito(pessoa)
  let iofDiario = 0
  for (const f of fluxos) {
    const dias = Math.min(Math.max(0, f.diasCorridos), 365)
    iofDiario += f.amortizacao * (diaria / 100) * dias
  }
  const iofAdicional = principal * (IOF_CREDITO_ADICIONAL / 100)
  return { pessoa, aliquotaDiaria: diaria, iofDiario, iofAdicional, total: iofDiario + iofAdicional }
}
