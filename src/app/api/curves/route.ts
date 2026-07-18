import { NextResponse } from 'next/server'
import { badRequest, parseDateParam, parseRateCode } from '../../../lib/api'
import { prisma } from '../../../lib/db'
import { ensureCurve } from '../../../lib/ingest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/curves?rate=PRE&date=2024-01-15[&fetch=0]
 *
 * Retorna a curva da taxa na data. Se a data ainda não estiver no banco,
 * consulta a B3 na hora e grava (consulta retroativa sob demanda) — a menos
 * que fetch=0.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const rate = parseRateCode(url.searchParams.get('rate'))
  const date = parseDateParam(url.searchParams.get('date'))
  const fetchIfMissing = url.searchParams.get('fetch') !== '0'

  if (!rate) return badRequest('Parâmetro "rate" inválido (esperado código como PRE, DIC…).')
  if (!date) return badRequest('Parâmetro "date" inválido (AAAA-MM-DD, entre 1995 e hoje).')

  try {
    // Só aceita códigos conhecidos: impede que typos disparem consultas à B3
    // e criem taxas-fantasma no banco.
    const known = await prisma.rateType.findUnique({ where: { code: rate } })
    if (!known) {
      return NextResponse.json(
        { error: `Taxa "${rate}" desconhecida. Consulte /api/rates.` },
        { status: 404 },
      )
    }

    const payload = await ensureCurve(rate, date, { fetchIfMissing })
    const res = NextResponse.json(payload)
    if (payload.status === 'OK') {
      // Curvas publicadas são imutáveis: pode cachear na borda.
      res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600')
    } else {
      res.headers.set('Cache-Control', 'no-store')
    }
    return res
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
