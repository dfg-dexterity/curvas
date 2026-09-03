import { NextResponse } from 'next/server'
import { badRequest, parseDateParam } from '../../../../lib/api'
import { CURVA_FORWARD_MOEDA, calcularNDF } from '../../../../lib/financas/mtm'
import { CurvaIndisponivelError, carregarInterpolador } from '../../../../lib/financas/curvas-server'
import { isValidISODate } from '../../../../lib/dates'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/mtm/ndf?moeda=USD&montante=1000000&posicao=comprada
 *   &dataMtM=2026-08-26&vencimento=2027-02-26&taxaContrato=5.42
 *
 * MtM de NDF: forward interpolado da curva de preço da moeda (PTX/EUR/JPY,
 * Manual §4.1–4.3) e desconto pela curva PRE, ambas na data de MtM.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const moeda = (url.searchParams.get('moeda') ?? 'USD').toUpperCase()
  const montante = Number(url.searchParams.get('montante'))
  const posicao = url.searchParams.get('posicao') === 'vendida' ? 'vendida' : 'comprada'
  const dataMtM = parseDateParam(url.searchParams.get('dataMtM'))
  const vencimento = url.searchParams.get('vencimento')?.trim() ?? ''
  const taxaContrato = Number(url.searchParams.get('taxaContrato'))

  const curvaMoeda = CURVA_FORWARD_MOEDA[moeda]
  if (!curvaMoeda) return badRequest('Moeda inválida (USD, EUR ou JPY).')
  if (!Number.isFinite(montante) || montante <= 0) return badRequest('Montante inválido.')
  if (!dataMtM) return badRequest('Parâmetro "dataMtM" inválido (AAAA-MM-DD).')
  if (!isValidISODate(vencimento) || vencimento <= dataMtM) {
    return badRequest('Parâmetro "vencimento" inválido (posterior à data de MtM).')
  }
  if (!Number.isFinite(taxaContrato) || taxaContrato <= 0) {
    return badRequest('Taxa contratada inválida.')
  }

  try {
    const [fwd, pre] = await Promise.all([
      carregarInterpolador(curvaMoeda, dataMtM),
      carregarInterpolador('PRE', dataMtM),
    ])

    const resultado = calcularNDF(
      { montante, posicao, dataMtM, dataVencimento: vencimento, taxaContrato },
      fwd.interp,
      pre.interp,
    )

    const res = NextResponse.json({
      moeda,
      curvaForward: { code: curvaMoeda, nome: fwd.rate.name, vertices: fwd.vertices },
      curvaDesconto: { code: 'PRE', nome: pre.rate.name, vertices: pre.vertices },
      dataMtM,
      vencimento,
      posicao,
      montante,
      taxaContrato,
      ...resultado,
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
