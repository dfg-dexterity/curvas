export interface RateOption {
  /** Código do parâmetro slcTaxa (ex.: PRE, DIC, DOC). */
  code: string
  /** Descrição exibida no site da B3 (ex.: "DI x pré"). */
  name: string
}

export interface CurveRow {
  /** Prazo em dias corridos. */
  days: number
  /** Taxa % a.a. base 252 dias úteis (composto), quando publicada. */
  rate252: number | null
  /** Taxa % a.a. base 360 dias corridos (linear), quando publicada. */
  rate360: number | null
}

export interface ParsedRatesPage {
  /** Todas as taxas listadas no dropdown da página (descoberta dinâmica). */
  options: RateOption[]
  /** Vértices da curva selecionada. */
  rows: CurveRow[]
  /** Quais bases a tabela desta taxa publica. */
  columns: { has252: boolean; has360: boolean }
  /** Mensagem da B3 quando não há dados para a data (feriado, data futura…). */
  emptyReason?: string
  /** Avisos não-fatais do parser (estrutura inesperada etc.). */
  warnings: string[]
}

export class B3FetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'B3FetchError'
  }
}

export class B3ParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'B3ParseError'
  }
}
