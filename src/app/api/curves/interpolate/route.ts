import { NextResponse } from 'next/server'
import { badRequest, parseDateParam, parseRateCode } from '../../../../lib/api'
import { businessDaysForCalendarDays, calendarDaysBetween } from '../../../../lib/curves/calendar'
import { buildInterpolator } from '../../../../lib/curves/interpolation'
import { isValidISODate } from '../../../../lib/dates'
import { prisma } from '../../../../lib/db'
import { ensureCurve } from '../../../../lib/ingest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Prazo máximo aceito: acima do vértice mais longo publicado (~12.449 dc). */
const MAX_TARGET_DC = 20_000

/**
 * GET /api/curves/interpolate?rate=PRE&date=2026-07-16&target=2027-01-15
 *
 * Interpola a curva (rate, date) na data-alvo, seguindo o Manual de Curvas da
 * B3: conta dias corridos/úteis (calendário ANBIMA) da data-base à data-alvo e
 * aplica a função de interpolação/extrapolação e o arredondamento da curva.
 * A data-alvo pode estar no futuro (além do último vértice → extrapolação).
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const rate = parseRateCode(url.searchParams.get('rate'))
  const date = parseDateParam(url.searchParams.get('date'))
  const targetRaw = url.searchParams.get('target')?.trim() ?? ''

  if (!rate) return badRequest('Parâmetro "rate" inválido (esperado código como PRE, DIC…).')
  if (!date) return badRequest('Parâmetro "date" inválido (AAAA-MM-DD, entre 1995 e hoje).')
  if (!isValidISODate(targetRaw)) {
    return badRequest('Parâmetro "target" inválido (data-alvo em AAAA-MM-DD).')
  }

  const dc = calendarDaysBetween(date, targetRaw)
  if (dc <= 0) return badRequest('A data-alvo deve ser posterior à data da curva.')
  if (dc > MAX_TARGET_DC) {
    return badRequest(`Data-alvo além do horizonte suportado (${MAX_TARGET_DC} dias corridos).`)
  }

  try {
    const knownRate = await prisma.rateType.findUnique({ where: { code: rate } })
    if (!knownRate) {
      return NextResponse.json(
        { error: `Taxa "${rate}" desconhecida. Consulte /api/rates.` },
        { status: 404 },
      )
    }

    const payload = await ensureCurve(rate, date)
    if (payload.status !== 'OK' || payload.points.length === 0) {
      return NextResponse.json(
        {
          error: 'Sem curva para a data.',
          status: payload.status,
          message: payload.message,
          nearestAvailable: payload.nearestAvailable,
        },
        { status: 404 },
      )
    }

    // A curva moderna publica uma base por produto; usa a coluna presente.
    const has252 = payload.points.some((p) => p.rate252 !== null)
    const basis = has252 ? '252' : '360'
    const points = payload.points
      .map((p) => ({ days: p.days, rate: has252 ? p.rate252 : p.rate360 }))
      .filter((p): p is { days: number; rate: number } => p.rate !== null)

    const du = businessDaysForCalendarDays(date, dc)
    if (du === 0) {
      return badRequest('Nenhum dia útil entre a data da curva e a data-alvo (feriados/fim de semana).')
    }

    const curve = buildInterpolator(rate, date, points)
    const value = curve.atCalendarDays(dc)

    const maxDc = Math.max(...points.map((p) => p.days))
    const minDc = Math.min(...points.map((p) => p.days))

    const res = NextResponse.json({
      rate: payload.rate,
      baseDate: date,
      targetDate: targetRaw,
      dc,
      du,
      basis,
      method: curve.config.method,
      rounding: curve.config.rounding ?? null,
      knownConfig: curve.known,
      extrapolated: dc > maxDc || dc < minDc,
      lastVertexDc: maxDc,
      value,
    })
    res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600')
    return res
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
