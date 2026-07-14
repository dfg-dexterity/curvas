import { NextResponse } from 'next/server'
import { badRequest, parseDateParam, parseRateCode } from '../../../../lib/api'
import { mapWithConcurrency } from '../../../../lib/concurrency'
import { prisma } from '../../../../lib/db'
import { ensureCurve } from '../../../../lib/ingest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_DATES = 6

/**
 * GET /api/curves/compare?rate=PRE&dates=2024-01-15,2023-01-16,2020-01-15
 *
 * Resolve até 6 datas da mesma taxa (com busca retroativa sob demanda) para
 * sobreposição de curvas.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const rate = parseRateCode(url.searchParams.get('rate'))
  const rawDates = (url.searchParams.get('dates') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (!rate) return badRequest('Parâmetro "rate" inválido.')
  if (rawDates.length === 0 || rawDates.length > MAX_DATES) {
    return badRequest(`Informe de 1 a ${MAX_DATES} datas separadas por vírgula.`)
  }

  const dates: string[] = []
  for (const raw of rawDates) {
    const date = parseDateParam(raw)
    if (!date) return badRequest(`Data inválida: "${raw}" (AAAA-MM-DD, entre 1995 e hoje).`)
    if (!dates.includes(date)) dates.push(date)
  }

  try {
    const known = await prisma.rateType.findUnique({ where: { code: rate } })
    if (!known) {
      return NextResponse.json(
        { error: `Taxa "${rate}" desconhecida. Consulte /api/rates.` },
        { status: 404 },
      )
    }

    const curves = await mapWithConcurrency(dates, 3, (date) => ensureCurve(rate, date))
    return NextResponse.json({ rate: { code: rate, name: known.name }, curves })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
