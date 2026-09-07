import { NextResponse } from 'next/server'
import { badRequest, parseDateParam, parseRateCode } from '../../../../lib/api'
import { businessDaysForCalendarDays, calendarDaysBetween } from '../../../../lib/curves/calendar'
import {
  buildInterpolator,
  type CurveConfig,
  type InterpolationDetail,
} from '../../../../lib/curves/interpolation'
import { isValidISODate } from '../../../../lib/dates'
import { prisma } from '../../../../lib/db'
import { ensureCurve } from '../../../../lib/ingest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Prazo máximo aceito: acima do vértice mais longo publicado (~12.449 dc). */
const MAX_TARGET_DC = 20_000

const nf = (value: number, decimals: number) =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

/** Memória de cálculo em passos legíveis, específica do método aplicado. */
function buildSteps(
  detail: InterpolationDetail & { target: { dc: number; du: number } },
  config: CurveConfig,
): string[] {
  const { anterior: a, posterior: b, factors, weight, target } = detail
  const roundingLabel = config.rounding
    ? `${config.rounding.mode === 'round' ? 'arredondado' : 'truncado'} na ${config.rounding.decimals}ª casa`
    : 'sem arredondamento'

  if (detail.mode === 'exact') {
    return [
      `A data-alvo cai exatamente em um vértice publicado (${target.dc} dias corridos); o valor divulgado pela B3 é usado diretamente, ${roundingLabel}.`,
    ]
  }
  if (detail.mode === 'flatEnd' || detail.mode === 'flatStart') {
    return [
      `A data-alvo está ${detail.mode === 'flatEnd' ? 'além do último' : 'antes do primeiro'} vértice e esta curva usa extrapolação flat (Manual 1.4.${detail.mode === 'flatEnd' ? '8' : '9'}): repete-se o valor do vértice extremo, ${roundingLabel}.`,
    ]
  }
  if (!a || !b || !factors || weight === undefined) return []

  const extrapNote =
    detail.mode === 'extrapolatedEnd'
      ? ' (alvo além do último vértice: o forward do último segmento é prolongado — Manual 1.4.6/1.4.10)'
      : detail.mode === 'extrapolatedStart'
        ? ' (alvo antes do primeiro vértice: o forward do primeiro segmento é usado para trás — Manual 1.4.7)'
        : ''

  const steps: string[] = []
  switch (config.method) {
    case 'ff252':
      steps.push(
        `Vértices vizinhos${extrapNote}: anterior ${a.dc} dc (${a.du} du) a ${nf(a.rate, 4)}% e posterior ${b.dc} dc (${b.du} du) a ${nf(b.rate, 4)}%.`,
        `Fatores base 252: f = (1 + i/100)^(du/252) → f_ant = ${nf(factors.anterior, 8)} e f_post = ${nf(factors.posterior, 8)}.`,
        `Peso pro-rata em dias úteis: w = (${target.du} − ${a.du}) / (${b.du} − ${a.du}) = ${nf(weight, 6)}.`,
        `Fator interpolado (forward constante no segmento): F = f_ant · (f_post/f_ant)^w = ${nf(factors.interpolated, 8)}.`,
        `Reanualização no prazo-alvo: taxa = (F^(252/${target.du}) − 1) · 100 = ${nf(detail.rawValue, 6)}%, ${roundingLabel} → ${nf(detail.value, config.rounding?.decimals ?? 6)}%.`,
      )
      break
    case 'ffLinear360':
      steps.push(
        `Vértices vizinhos${extrapNote}: anterior ${a.dc} dc a ${nf(a.rate, 4)}% e posterior ${b.dc} dc a ${nf(b.rate, 4)}%.`,
        `Fatores lineares 360: f = 1 + i·dc/36000 → f_ant = ${nf(factors.anterior, 8)} e f_post = ${nf(factors.posterior, 8)}.`,
        `Peso pro-rata em dias úteis: w = (${target.du} − ${a.du}) / (${b.du} − ${a.du}) = ${nf(weight, 6)}.`,
        `Fator interpolado: F = f_ant · (f_post/f_ant)^w = ${nf(factors.interpolated, 8)}.`,
        `Deslinearização no prazo-alvo: taxa = (F − 1) · 36000/${target.dc} = ${nf(detail.rawValue, 6)}%, ${roundingLabel} → ${nf(detail.value, config.rounding?.decimals ?? 6)}%.`,
      )
      break
    case 'exp360':
      steps.push(
        `Vértices vizinhos${extrapNote}: anterior ${a.dc} dc a ${nf(a.rate, 4)}% e posterior ${b.dc} dc a ${nf(b.rate, 4)}%.`,
        `Fatores base 360: f = (1 + i/100)^(dc/360) → f_ant = ${nf(factors.anterior, 8)} e f_post = ${nf(factors.posterior, 8)}.`,
        `Peso pro-rata em dias corridos: w = (${target.dc} − ${a.dc}) / (${b.dc} − ${a.dc}) = ${nf(weight, 6)}.`,
        `Fator interpolado: F = f_ant · (f_post/f_ant)^w = ${nf(factors.interpolated, 8)}.`,
        `Reanualização: taxa = (F^(360/${target.dc}) − 1) · 100 = ${nf(detail.rawValue, 6)}%, ${roundingLabel}.`,
      )
      break
    case 'exp252':
      steps.push(
        `Vértices vizinhos${extrapNote}: anterior ${a.du} du a ${nf(a.rate, 4)}% e posterior ${b.du} du a ${nf(b.rate, 4)}%.`,
        `Peso pro-rata em dias úteis: w = (${target.du} − ${a.du}) / (${b.du} − ${a.du}) = ${nf(weight, 6)}.`,
        `Interpolação geométrica de (1+i): taxa = ((1+i_ant/100) · ((1+i_post/100)/(1+i_ant/100))^w − 1) · 100 = ${nf(detail.rawValue, 6)}%, ${roundingLabel}.`,
      )
      break
    case 'price':
      steps.push(
        `Vértices vizinhos${extrapNote}: anterior ${a.dc} dc (${a.du} du) a ${nf(a.rate, 7)} e posterior ${b.dc} dc (${b.du} du) a ${nf(b.rate, 7)}.`,
        `Peso pro-rata em dias úteis: w = (${target.du} − ${a.du}) / (${b.du} − ${a.du}) = ${nf(weight, 6)}.`,
        `Interpolação geométrica de preços: P = P_ant · (P_post/P_ant)^w = ${nf(detail.rawValue, 7)}, ${roundingLabel}.`,
      )
      break
    case 'linear360':
      steps.push(
        `Vértices vizinhos${extrapNote}: anterior ${a.dc} dc a ${nf(a.rate, 4)} e posterior ${b.dc} dc a ${nf(b.rate, 4)}.`,
        `Capitalizações lineares: cap = i·dc/36000 → cap_ant = ${nf(factors.anterior, 8)} e cap_post = ${nf(factors.posterior, 8)}.`,
        `Interpolação linear em dias corridos: cap = ${nf(factors.interpolated, 8)}.`,
        `Deslinearização: taxa = cap · 36000/${target.dc} = ${nf(detail.rawValue, 6)}, ${roundingLabel}.`,
      )
      break
  }
  return steps
}

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
    const detail = curve.explainAtCalendarDays(dc)

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
      value: detail.value,
      explanation: {
        mode: detail.mode,
        anterior: detail.anterior ?? null,
        posterior: detail.posterior ?? null,
        weight: detail.weight ?? null,
        rawValue: detail.rawValue,
        steps: buildSteps(detail, curve.config),
      },
    })
    res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600')
    return res
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
