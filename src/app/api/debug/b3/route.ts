import { NextResponse } from 'next/server'
import { buildRatesUrl } from '../../../../lib/b3/client'
import { latestExpectedDataDate, previousBusinessDay } from '../../../../lib/dates'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

interface ProbeResult {
  url: string
  status?: number
  contentType?: string | null
  server?: string | null
  bodyStart?: string
  error?: string
}

async function probe(url: string, accept: string): Promise<ProbeResult> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'pt-BR,pt;q=0.9' },
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    })
    const body = await res.text()
    return {
      url,
      status: res.status,
      contentType: res.headers.get('content-type'),
      server: res.headers.get('server'),
      bodyStart: body.slice(0, 700).replace(/\s+/g, ' '),
    }
  } catch (err) {
    return { url, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }
  }
}

/**
 * Diagnóstico (protegido por CRON_SECRET): mostra o que a B3 responde a este
 * ambiente de execução — página legada (www2.bmf.com.br) e API JSON moderna.
 * Uso: /api/debug/b3?secret=...&date=2026-07-13
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const secret = process.env.CRON_SECRET
  if (!secret || url.searchParams.get('secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const date = url.searchParams.get('date') ?? previousBusinessDay(latestExpectedDataDate())
  const [y, m, d] = date.split('-')

  const legacy = await probe(buildRatesUrl(date, 'PRE'), 'text/html,application/xhtml+xml')
  const modern = await probe(
    `https://sistemaswebb3-derivativos.b3.com.br/referenceRatesProxy/TaxasReferenciais?data=${d}/${m}/${y}&slcTaxa=PRE`,
    'application/json, text/plain, */*',
  )

  return NextResponse.json({ date, legacy, modern })
}
