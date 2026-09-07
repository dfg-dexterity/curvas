import { NextResponse } from 'next/server'
import { badRequest, parseDateParam } from '../../../../lib/api'
import { fetchSGS, SGS_CDI, SGS_SELIC } from '../../../../lib/bcb'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/bcb/cdi?from=2023-01-02&to=2024-01-02[&serie=selic]
 *
 * Proxy da série diária do CDI (SGS 4389) — ou da Selic (SGS 1178) — do BCB,
 * consumida pela Correção CDI e pelo MtM de swaps. Server-side (sem CORS),
 * com cache na borda: o histórico publicado é imutável.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const from = parseDateParam(url.searchParams.get('from'))
  const to = parseDateParam(url.searchParams.get('to'))
  const serieParam = url.searchParams.get('serie')?.toLowerCase() ?? 'cdi'

  if (!from) return badRequest('Parâmetro "from" inválido (AAAA-MM-DD).')
  if (!to || to < from) return badRequest('Parâmetro "to" inválido (AAAA-MM-DD, posterior a "from").')
  if (serieParam !== 'cdi' && serieParam !== 'selic') {
    return badRequest('Parâmetro "serie" deve ser "cdi" ou "selic".')
  }

  try {
    const serie = await fetchSGS(serieParam === 'selic' ? SGS_SELIC : SGS_CDI, from, to)
    const res = NextResponse.json({ serie, indexador: serieParam, from, to })
    res.headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
    return res
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Falha ao consultar o BCB: ${message}` }, { status: 502 })
  }
}
