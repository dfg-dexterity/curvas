import { NextResponse } from 'next/server'
import { badRequest, parseDateParam } from '../../../../lib/api'
import { CURVA_FORWARD_MOEDA, duEntreDatas } from '../../../../lib/financas/mtm'
import { mtmOpcaoMoeda } from '../../../../lib/financas/opcoes'
import { CurvaIndisponivelError, carregarInterpolador } from '../../../../lib/financas/curvas-server'
import { calendarDaysBetween } from '../../../../lib/curves/calendar'
import { isValidISODate } from '../../../../lib/dates'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/mtm/fx-option?moeda=USD&tipo=call&posicao=comprada&montante=1000000
 *   &strike=5.60&vol=14.5&dataMtM=2026-08-26&vencimento=2027-02-26
 *   [&premioContratado=0.18][&forward=5.72]
 *
 * MtM de opção de moeda OTC pelo modelo de Black sobre o forward: F vem da
 * curva de preço da moeda (PTX/EUR/JPY) — ou do parâmetro `forward` — e o
 * desconto da curva PRE; vol informada em % a.a. (base 252 du).
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const moeda = (url.searchParams.get('moeda') ?? 'USD').toUpperCase()
  const tipo = url.searchParams.get('tipo') === 'put' ? 'put' : 'call'
  const posicao = url.searchParams.get('posicao') === 'vendida' ? 'vendida' : 'comprada'
  const montante = Number(url.searchParams.get('montante'))
  const strike = Number(url.searchParams.get('strike'))
  const vol = Number(url.searchParams.get('vol'))
  const dataMtM = parseDateParam(url.searchParams.get('dataMtM'))
  const vencimento = url.searchParams.get('vencimento')?.trim() ?? ''
  const premioRaw = url.searchParams.get('premioContratado')
  const premioContratado = premioRaw !== null && premioRaw !== '' ? Number(premioRaw) : undefined
  const forwardRaw = url.searchParams.get('forward')
  const forwardManual = forwardRaw !== null && forwardRaw !== '' ? Number(forwardRaw) : undefined

  const curvaMoeda = CURVA_FORWARD_MOEDA[moeda]
  if (!curvaMoeda) return badRequest('Moeda inválida (USD, EUR ou JPY).')
  if (!Number.isFinite(montante) || montante <= 0) return badRequest('Montante inválido.')
  if (!Number.isFinite(strike) || strike <= 0) return badRequest('Strike inválido.')
  if (!Number.isFinite(vol) || vol <= 0) return badRequest('Volatilidade inválida (% a.a. > 0).')
  if (!dataMtM) return badRequest('Parâmetro "dataMtM" inválido (AAAA-MM-DD).')
  if (!isValidISODate(vencimento) || vencimento <= dataMtM) {
    return badRequest('Parâmetro "vencimento" inválido (posterior à data de MtM).')
  }
  if (premioContratado !== undefined && (!Number.isFinite(premioContratado) || premioContratado < 0)) {
    return badRequest('Prêmio contratado inválido.')
  }
  if (forwardManual !== undefined && (!Number.isFinite(forwardManual) || forwardManual <= 0)) {
    return badRequest('Forward manual inválido.')
  }

  try {
    const dc = calendarDaysBetween(dataMtM, vencimento)
    const du = duEntreDatas(dataMtM, vencimento)
    if (du <= 0) return badRequest('Sem dias úteis entre a data de MtM e o vencimento.')

    const pre = await carregarInterpolador('PRE', dataMtM)
    let forward = forwardManual
    let curvaForward: { code: string; nome: string; vertices: number } | null = null
    if (forward === undefined) {
      const fwd = await carregarInterpolador(curvaMoeda, dataMtM)
      forward = fwd.interp.atCalendarDays(dc)
      curvaForward = { code: curvaMoeda, nome: fwd.rate.name, vertices: fwd.vertices }
    }

    const taxaDesconto = pre.interp.atCalendarDays(dc)
    const resultado = mtmOpcaoMoeda(
      { tipo, forward, strike, volAA: vol, du, taxaDesconto },
      { posicao, montante, premioContratado },
    )

    const res = NextResponse.json({
      moeda,
      posicao,
      montante,
      strike,
      volAA: vol,
      dataMtM,
      vencimento,
      dc,
      du,
      forward,
      forwardManual: forwardManual !== undefined,
      taxaDesconto,
      curvaForward,
      curvaDesconto: { code: 'PRE', nome: pre.rate.name, vertices: pre.vertices },
      ...resultado,
      premioTotal: resultado.premio * montante,
    })
    res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600')
    return res
  } catch (err) {
    if (err instanceof CurvaIndisponivelError) {
      return NextResponse.json(
        { error: err.message, status: err.status, nearestAvailable: err.nearestAvailable },
        { status: 404 },
      )
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
