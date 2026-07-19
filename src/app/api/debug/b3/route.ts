import { NextResponse } from 'next/server'
import {
  buildSearchUrl,
  fetchAvailableDates,
  fetchProducts,
  fetchRatesPage,
} from '../../../../lib/b3/client'
import { latestExpectedDataDate, previousBusinessDay, toUTCDate } from '../../../../lib/dates'
import { prisma } from '../../../../lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface CallProbe {
  url: string
  status?: number
  contentType?: string | null
  len?: number
  head?: string
  error?: string
}

async function probeRaw(url: string): Promise<CallProbe> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://sistemaswebb3-derivativos.b3.com.br/referenceRatesPage/',
      },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    })
    const text = await res.text()
    return {
      url,
      status: res.status,
      contentType: res.headers.get('content-type'),
      len: text.length,
      head: text.slice(0, 500).replace(/\s+/g, ' '),
    }
  } catch (err) {
    return { url, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }
  }
}

/**
 * Sondagem diagnóstica v4: valida o cliente da API moderna de ponta a ponta.
 * Sem autenticação por design (consulta apenas endpoints públicos da B3).
 * Grava o resultado em FetchLog sob o código inativo '_DIAG' para leitura via
 * SQL, além de respondê-lo no corpo.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const date = url.searchParams.get('date') ?? previousBusinessDay(latestExpectedDataDate())
  const rate = (url.searchParams.get('rate') ?? 'PRE').toUpperCase()

  // 1. Chamadas cruas (revelam status/corpo mesmo se o mapeamento falhar).
  const raws = await Promise.all([
    probeRaw(buildSearchUrl('GetProducts', { language: 'pt-br' })),
    probeRaw(buildSearchUrl('GetDate', { language: 'pt-br', id: rate })),
    probeRaw(
      buildSearchUrl('GetList', { language: 'pt-br', id: rate, date, pageNumber: 1, pageSize: 5 }),
    ),
  ])

  // 2. Cliente mapeado, na data pedida e na última data publicada.
  const client: Record<string, unknown> = {}
  try {
    const products = await fetchProducts()
    client.products = { count: products.length, first: products.slice(0, 6) }
  } catch (err) {
    client.productsError = err instanceof Error ? err.message : String(err)
  }
  let publishedDates: string[] = []
  try {
    publishedDates = await fetchAvailableDates(rate)
    client.dates = { count: publishedDates.length, latest: publishedDates.slice(0, 5) }
  } catch (err) {
    client.datesError = err instanceof Error ? err.message : String(err)
  }
  for (const [label, d] of [
    ['requested', date],
    ['latestPublished', publishedDates[0]],
  ] as Array<[string, string | undefined]>) {
    if (!d) continue
    try {
      const page = await fetchRatesPage(rate, d)
      client[label] = {
        date: d,
        rows: page.rows.length,
        columns: page.columns,
        emptyReason: page.emptyReason,
        warnings: page.warnings,
        sample: page.rows.slice(0, 3),
      }
    } catch (err) {
      client[`${label}Error`] = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    }
  }

  const result = {
    v: 4,
    ranAt: new Date().toISOString(),
    date,
    rate,
    region: process.env.VERCEL_REGION ?? null,
    raws,
    client,
  }

  // Persiste para leitura via SQL (melhor esforço).
  let persisted = false
  try {
    await prisma.rateType.upsert({
      where: { code: '_DIAG' },
      create: { code: '_DIAG', name: 'Sondagem diagnóstica (interno)', active: false },
      update: { active: false },
    })
    await prisma.fetchLog.upsert({
      where: { rateCode_date: { rateCode: '_DIAG', date: toUTCDate(date) } },
      create: { rateCode: '_DIAG', date: toUTCDate(date), status: 'ERROR', points: 0, message: JSON.stringify(result) },
      update: { status: 'ERROR', points: 0, message: JSON.stringify(result), fetchedAt: new Date() },
    })
    persisted = true
  } catch {
    // sem banco, ainda devolvemos o JSON na resposta
  }

  return NextResponse.json({ ...result, persisted })
}
