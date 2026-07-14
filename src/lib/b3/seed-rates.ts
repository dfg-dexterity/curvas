import type { RateOption } from './types'

/**
 * Lista-semente usada SOMENTE quando o banco ainda não tem nenhuma taxa e a
 * descoberta dinâmica (parse do dropdown da página da B3) falhou. Assim que a
 * página é lida com sucesso, os códigos/nomes reais substituem estes valores e
 * códigos inexistentes são desativados automaticamente.
 */
export const SEED_RATES: RateOption[] = [
  { code: 'PRE', name: 'DI x pré' },
  { code: 'DIC', name: 'DI x IPCA' },
  { code: 'DIM', name: 'DI x IGP-M' },
  { code: 'DOC', name: 'Cupom cambial OC1' },
  { code: 'DOL', name: 'Cupom limpo' },
  { code: 'APR', name: 'Ajustes de pré' },
  { code: 'SLP', name: 'Selic x pré' },
  { code: 'TP', name: 'TR x pré' },
  { code: 'TFP', name: 'TBF x pré' },
  { code: 'EUC', name: 'Cupom de euro' },
  { code: 'EUR', name: 'Real x euro' },
  { code: 'JPY', name: 'Real x iene' },
  { code: 'INP', name: 'Ibovespa' },
  { code: 'PTX', name: 'Dólar x pré' },
  { code: 'LIB', name: 'Libor' },
  { code: 'SDE', name: 'Spread dólar euro' },
]
