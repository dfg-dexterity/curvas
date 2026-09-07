import { NextResponse } from 'next/server'
import { buildSearchUrl } from '../../../../lib/b3/client'
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

  // Analisa a semântica do campo "curve" do GetList: para cada produto-alvo,
  // baixa uma amostra grande e resume valores distintos de curve com amostras
  // do início/meio/fim de cada grupo.
  interface ApiRow {
    code?: unknown
    curve?: unknown
    description?: unknown
    day252?: unknown
    day360?: unknown
    rate?: unknown
  }
  async function analyze(id: string): Promise<Record<string, unknown>> {
    // pageSize > 120 faz a API devolver envelope vazio; paginamos com 120.
    const all: ApiRow[] = []
    let pageInfo: { totalRecords?: number; totalPages?: number } | null = null
    let error: string | undefined
    for (let pageNumber = 1; pageNumber <= 4; pageNumber++) {
      const raw = await probeRaw(
        buildSearchUrl('GetList', { language: 'pt-br', id, date, pageNumber, pageSize: 120 }),
      )
      if (raw.error || raw.status !== 200) {
        error = raw.error ?? `HTTP ${raw.status}`
        break
      }
      try {
        const parsed = JSON.parse(
          await (
            await fetch(raw.url, {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Accept: 'application/json, text/plain, */*',
                Referer: 'https://sistemaswebb3-derivativos.b3.com.br/referenceRatesPage/',
              },
              signal: AbortSignal.timeout(15_000),
              cache: 'no-store',
            })
          ).text(),
        ) as { page?: { totalRecords?: number; totalPages?: number }; results?: ApiRow[] }
        pageInfo = parsed?.page ?? pageInfo
        const results = parsed?.results ?? []
        all.push(...results)
        const totalPages = parsed?.page?.totalPages ?? 1
        if (results.length === 0 || pageNumber >= totalPages) break
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
        break
      }
    }

    const groups: Record<string, { count: number; sample: ApiRow[] }> = {}
    for (const row of all) {
      const key = String(row.curve ?? '?')
      groups[key] ??= { count: 0, sample: [] }
      groups[key].count++
    }
    for (const key of Object.keys(groups)) {
      const rows = all.filter((r) => String(r.curve ?? '?') === key)
      groups[key].sample = [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]].filter(Boolean)
    }
    return { id, fetched: all.length, page: pageInfo, curves: groups, error }
  }

  const [pre, dol, dic] = await Promise.all([analyze('PRE'), analyze('DOL'), analyze('DIC')])

  const result = {
    v: 6,
    ranAt: new Date().toISOString(),
    date,
    rate,
    region: process.env.VERCEL_REGION ?? null,
    pre,
    dol,
    dic,
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
