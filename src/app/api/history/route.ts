import { NextResponse } from 'next/server'
import { badRequest, parseDateParam, parseRateCode } from '../../../lib/api'
import { addDays, isValidISODate } from '../../../lib/dates'
import { prisma } from '../../../lib/db'

export const dynamic = 'force-dynamic'

const MAX_SPAN_DAYS = 3660 // ~10 anos por consulta

interface BracketRow {
  date_iso: string
  days: number
  r252: string | null
  r360: string | null
}

function lerp(x0: number, y0: number, x1: number, y1: number, x: number): number {
  if (x1 === x0) return y0
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
}

function toNum(value: string | null): number | null {
  if (value === null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * GET /api/history?rate=PRE&days=365[&from=…][&to=…]
 *
 * Série temporal da taxa em um prazo fixo (dias corridos), calculada sobre as
 * curvas já armazenadas. Quando o prazo não é um vértice publicado, interpola
 * linearmente entre os vértices vizinhos. Só usa o banco (não consulta a B3):
 * a densidade da série reflete as datas já capturadas.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const rate = parseRateCode(url.searchParams.get('rate'))
  const days = Number.parseInt(url.searchParams.get('days') ?? '', 10)

  if (!rate) return badRequest('Parâmetro "rate" inválido.')
  if (!Number.isFinite(days) || days < 1 || days > 20000) {
    return badRequest('Parâmetro "days" inválido (1 a 20000 dias corridos).')
  }

  try {
    const latest = await prisma.curvePoint.findFirst({
      where: { rateCode: rate },
      orderBy: { date: 'desc' },
      select: { date: true },
    })
    if (!latest) {
      return NextResponse.json({ rate, days, from: null, to: null, series: [] })
    }

    const latestISO = latest.date.toISOString().slice(0, 10)
    const rawTo = url.searchParams.get('to')
    const rawFrom = url.searchParams.get('from')
    const to = rawTo ? parseDateParam(rawTo) : latestISO
    const from = rawFrom && isValidISODate(rawFrom) ? rawFrom : addDays(to ?? latestISO, -365)
    if (!to || !isValidISODate(from) || from > to) {
      return badRequest('Intervalo from/to inválido.')
    }
    if (addDays(from, MAX_SPAN_DAYS) < to) {
      return badRequest(`Intervalo máximo de ${MAX_SPAN_DAYS} dias por consulta.`)
    }

    // Para cada data, o vértice mais próximo abaixo e acima do prazo pedido.
    const [lower, upper] = await Promise.all([
      prisma.$queryRaw<BracketRow[]>`
        SELECT DISTINCT ON ("date")
               to_char("date", 'YYYY-MM-DD') AS date_iso,
               "days",
               "rate252"::text AS r252,
               "rate360"::text AS r360
        FROM "CurvePoint"
        WHERE "rateCode" = ${rate}
          AND "date" >= ${from}::date AND "date" <= ${to}::date
          AND "days" <= ${days}
        ORDER BY "date", "days" DESC
      `,
      prisma.$queryRaw<BracketRow[]>`
        SELECT DISTINCT ON ("date")
               to_char("date", 'YYYY-MM-DD') AS date_iso,
               "days",
               "rate252"::text AS r252,
               "rate360"::text AS r360
        FROM "CurvePoint"
        WHERE "rateCode" = ${rate}
          AND "date" >= ${from}::date AND "date" <= ${to}::date
          AND "days" >= ${days}
        ORDER BY "date", "days" ASC
      `,
    ])

    const upperByDate = new Map(upper.map((row) => [row.date_iso, row]))
    const series: Array<{ date: string; rate252: number | null; rate360: number | null }> = []

    for (const lo of lower) {
      const hi = upperByDate.get(lo.date_iso)

      const interpolate = (
        loVal: string | null,
        hiVal: string | null | undefined,
        hiDays: number | undefined,
      ): number | null => {
        const y0 = toNum(loVal)
        if (lo.days === days) return y0
        const y1 = toNum(hiVal ?? null)
        if (y0 === null || y1 === null || hiDays === undefined) return null
        return lerp(lo.days, y0, hiDays, y1, days)
      }

      const rate252 = interpolate(lo.r252, hi?.r252, hi?.days)
      const rate360 = interpolate(lo.r360, hi?.r360, hi?.days)
      if (rate252 !== null || rate360 !== null) {
        series.push({ date: lo.date_iso, rate252, rate360 })
      }
    }

    series.sort((a, b) => (a.date < b.date ? -1 : 1))
    return NextResponse.json({ rate, days, from, to, interpolated: true, series })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
