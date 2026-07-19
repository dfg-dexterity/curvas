import { B3FetchError, B3ParseError, type CurveRow, type ParsedRatesPage, type RateOption } from './types'
import { parseIntBr, parseRateBr } from './parse'

/**
 * Cliente da API moderna de Taxas Referenciais da B3.
 *
 * A página legada (www2.bmf.com.br/.../lum-taxas-referenciais-bmf-ptBR.asp)
 * foi desativada — o wrapper virou uma casca vazia e o TxRef1.asp interno
 * retorna 404. Os dados vivem na SPA "Taxas de Referência", servida por
 * https://sistemaswebb3-derivativos.b3.com.br/referenceRatesProxy/, no padrão
 * das SPAs da B3: GET Search/<Método>/<base64(JSON dos parâmetros)>.
 *
 * Métodos usados (descobertos no bundle main-*.js da SPA):
 *   Search/GetProducts/{language}            -> [{id, description, descriptionUs}]
 *   Search/GetDate/{language, id}            -> ["2026-07-17T00:00:00", ...] (desc)
 *   Search/GetList/{language, id, date,      -> {page:{totalRecords,totalPages,...},
 *                   pageNumber, pageSize}        results:[{description, day252, day360}]}
 */

const DEFAULT_PROXY_URL = 'https://sistemaswebb3-derivativos.b3.com.br/referenceRatesProxy/'
const SPA_REFERER = 'https://sistemaswebb3-derivativos.b3.com.br/referenceRatesPage/'

// A B3 rejeita user-agents genéricos; simulamos um navegador comum.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const LANGUAGE = 'pt-br'
const TIMEOUT_MS = 20_000
const MAX_ATTEMPTS = 3
const PAGE_SIZE = 120
const MAX_PAGES = 40
const PRODUCTS_CACHE_MS = 30 * 60 * 1000

export function proxyBaseUrl(): string {
  const base = process.env.B3_PROXY_URL || DEFAULT_PROXY_URL
  return base.endsWith('/') ? base : `${base}/`
}

function encodeParams(params: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(params), 'utf-8').toString('base64')
}

/** URL de um método Search/* com os parâmetros codificados (útil p/ debug). */
export function buildSearchUrl(method: string, params: Record<string, unknown>): string {
  return `${proxyBaseUrl()}Search/${method}/${encodeParams(params)}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** GET JSON com retry exponencial. 4xx (exceto 429) não é repetido. */
async function getJson<T>(url: string): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'pt-BR,pt;q=0.9',
          Referer: SPA_REFERER,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      })

      if (!res.ok) {
        const retryable = res.status >= 500 || res.status === 429
        const err = new B3FetchError(`B3 respondeu HTTP ${res.status} para ${url}`, res.status)
        if (!retryable) throw err
        lastError = err
      } else {
        const text = await res.text()
        try {
          // Respostas vazias ("") acontecem em métodos sem dados; trata como null.
          return (text ? JSON.parse(text) : null) as T
        } catch {
          lastError = new B3FetchError(`B3 devolveu corpo não-JSON (${text.slice(0, 120)})`)
        }
      }
    } catch (err) {
      if (err instanceof B3FetchError && err.status && err.status < 500 && err.status !== 429) {
        throw err
      }
      lastError = err
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(800 * 2 ** (attempt - 1) + Math.random() * 400)
    }
  }

  if (lastError instanceof Error) {
    throw new B3FetchError(`Falha ao consultar a B3 após ${MAX_ATTEMPTS} tentativas: ${lastError.message}`)
  }
  throw new B3FetchError(`Falha ao consultar a B3 após ${MAX_ATTEMPTS} tentativas`)
}

interface ApiProduct {
  id?: unknown
  description?: unknown
  descriptionUs?: unknown
}

interface ApiListResponse {
  page?: { pageNumber?: number; pageSize?: number; totalRecords?: number; totalPages?: number }
  results?: unknown[]
}

/** Lista de produtos (taxas) do dropdown da SPA. */
export async function fetchProducts(): Promise<RateOption[]> {
  const raw = await getJson<ApiProduct[] | null>(buildSearchUrl('GetProducts', { language: LANGUAGE }))
  const options: RateOption[] = []
  const seen = new Set<string>()
  for (const item of raw ?? []) {
    const code = String(item?.id ?? '').trim().toUpperCase()
    const name = String(item?.description ?? '').trim()
    if (!/^[A-Z]{2,6}$/.test(code) || seen.has(code)) continue
    seen.add(code)
    options.push({ code, name: name || code })
  }
  return options
}

let productsCache: { at: number; list: RateOption[] } | null = null

async function fetchProductsCached(): Promise<RateOption[]> {
  if (productsCache && Date.now() - productsCache.at < PRODUCTS_CACHE_MS && productsCache.list.length >= 3) {
    return productsCache.list
  }
  try {
    const list = await fetchProducts()
    if (list.length > 0) productsCache = { at: Date.now(), list }
    return list
  } catch {
    // Descoberta é oportunista: sem lista, o chamador segue com o que tem.
    return productsCache?.list ?? []
  }
}

/** Datas com publicação para uma taxa, em ISO (mais recente primeiro). */
export async function fetchAvailableDates(rateCode: string): Promise<string[]> {
  const raw = await getJson<unknown[] | null>(
    buildSearchUrl('GetDate', { language: LANGUAGE, id: rateCode }),
  )
  const dates: string[] = []
  for (const item of raw ?? []) {
    const iso = String(item ?? '').slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso) && !dates.includes(iso)) dates.push(iso)
  }
  return dates.sort((a, b) => (a < b ? 1 : -1))
}

function asDays(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string') return parseIntBr(value)
  return null
}

function asRate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') return parseRateBr(value)
  return null
}

export type RateBasis = '252' | '360'

/**
 * Base de juros convencional de cada taxa, herdada da tabela legada (que
 * imprimia cada produto na sua coluna): pré/inflação/índices em % a.a. base
 * 252 dias úteis (composto); cupons cambiais e moedas em % a.a. base 360 dias
 * corridos (linear). A API moderna publica UMA taxa por vértice na base
 * convencional do produto — confirmado em produção: PRE 14,15…14,43 (252),
 * DOL -40,85…18,52 (360 linear, curtíssimo negativo típico do cupom).
 */
const BASIS_252 = new Set(['PRE', 'DIC', 'DIM', 'SLP', 'APR', 'TP', 'TFP', 'INP'])
const BASIS_360 = new Set(['DOL', 'DOC', 'DCO', 'ACC', 'EUC', 'EUR', 'JPY', 'LIB', 'SDE', 'PTX'])

export function basisFor(rateCode: string): { basis: RateBasis; known: boolean } {
  const code = rateCode.toUpperCase()
  if (BASIS_252.has(code)) return { basis: '252', known: true }
  if (BASIS_360.has(code)) return { basis: '360', known: true }
  return { basis: '252', known: false }
}

/**
 * Converte uma linha do GetList em vértice. Na API moderna cada linha é um
 * vértice único: "day252"/"day360" são o PRAZO em dias úteis/corridos,
 * "description" é o nome da taxa e "rate" é a taxa na base convencional do
 * produto. Mantemos "dias corridos" como chave (mesma semântica da tabela
 * legada) e gravamos a taxa na coluna da base indicada.
 */
export function mapApiRow(raw: unknown, basis: RateBasis): CurveRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  const days = asDays(row.day360 ?? row.days)
  const rate = asRate(row.rate ?? row.taxa)
  if (days === null || rate === null) return null
  return {
    days,
    rate252: basis === '252' ? rate : null,
    rate360: basis === '360' ? rate : null,
  }
}

/** Busca todas as páginas do GetList de (taxa, data). */
async function fetchAllListRows(rateCode: string, dateISO: string): Promise<{ raw: unknown[]; totalRecords: number }> {
  const all: unknown[] = []
  let totalRecords = 0

  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
    const res = await getJson<ApiListResponse | null>(
      buildSearchUrl('GetList', {
        language: LANGUAGE,
        id: rateCode,
        date: dateISO,
        pageNumber,
        pageSize: PAGE_SIZE,
      }),
    )
    const results = res?.results ?? []
    all.push(...results)
    totalRecords = res?.page?.totalRecords ?? all.length
    const totalPages = res?.page?.totalPages ?? 1
    if (pageNumber >= totalPages || results.length === 0) break
  }

  return { raw: all, totalRecords }
}

/**
 * Busca e interpreta a curva de (taxa, data) na API moderna, mantendo o
 * contrato ParsedRatesPage do parser legado:
 * - rows vazio + emptyReason  => a B3 não publica essa data (EMPTY definitivo);
 * - rows vazio sem emptyReason => inconsistência re-tentável (vira ERROR);
 * - estrutura irreconhecível   => B3ParseError (vira ERROR com diagnóstico).
 */
export async function fetchRatesPage(rateCode: string, dateISO: string): Promise<ParsedRatesPage> {
  const [{ raw, totalRecords }, options] = await Promise.all([
    fetchAllListRows(rateCode, dateISO),
    fetchProductsCached(),
  ])

  const warnings: string[] = []

  if (raw.length === 0 || totalRecords === 0) {
    // Distingue "data sem publicação" (vazio oficial) de anomalia re-tentável
    // consultando o calendário da própria taxa.
    let published: string[] = []
    try {
      published = await fetchAvailableDates(rateCode)
    } catch {
      // sem calendário, não dá para afirmar que o vazio é definitivo
    }
    if (published.length > 0 && !published.includes(dateISO)) {
      return {
        options,
        rows: [],
        columns: { has252: false, has360: false },
        emptyReason: 'B3: não há dados publicados para esta taxa na data.',
        warnings,
      }
    }
    return { options, rows: [], columns: { has252: false, has360: false }, warnings }
  }

  const { basis, known } = basisFor(rateCode)
  if (!known) {
    warnings.push(`Base de juros desconhecida para ${rateCode}; taxa registrada como base 252.`)
  }

  const byDays = new Map<number, CurveRow>()
  for (const item of raw) {
    const row = mapApiRow(item, basis)
    if (!row) continue
    if (byDays.has(row.days)) {
      warnings.push(`Prazo duplicado no GetList: ${row.days} dias; mantida a primeira ocorrência.`)
      continue
    }
    byDays.set(row.days, row)
  }

  if (byDays.size === 0) {
    const keys = typeof raw[0] === 'object' && raw[0] !== null ? Object.keys(raw[0] as object).join(',') : typeof raw[0]
    throw new B3ParseError(`GetList retornou ${raw.length} registros com estrutura inesperada (campos: ${keys}).`)
  }

  const rows = [...byDays.values()].sort((a, b) => a.days - b.days)
  return {
    options,
    rows,
    columns: {
      has252: rows.some((r) => r.rate252 !== null),
      has360: rows.some((r) => r.rate360 !== null),
    },
    warnings,
  }
}
