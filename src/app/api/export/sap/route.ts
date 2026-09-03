import { NextResponse } from 'next/server'
import { badRequest, parseDateParam, parseRateCode } from '../../../../lib/api'
import { businessDaysForCalendarDays } from '../../../../lib/curves/calendar'
import { prisma } from '../../../../lib/db'
import { ensureCurve } from '../../../../lib/ingest'
import { buildSapCurveExport, type SapNumbering } from '../../../../lib/sap'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/export/sap?date=2026-07-17&rates=PRE[,DIC…]
 *
 * Gera o arquivo de carga SAP da(s) curva(s) na data: um registro por vértice,
 * código com o dia acrescido (DIPRE001 = 1º dia da curva DI x pré).
 *
 * Parâmetros opcionais:
 * - numbering=index|dc|du  sufixo do código (padrão: index — 1º, 2º, 3º…);
 * - header=1               inclui linha de cabeçalho;
 * - include=dc,du          colunas extras entre a data e a taxa;
 * - sep=;                  separador (padrão ponto e vírgula).
 * Sem "rates", exporta todas as taxas ativas COM dados na data (sem buscar na
 * B3); com "rates" explícito, busca na B3 sob demanda o que faltar.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const date = parseDateParam(url.searchParams.get('date'))
  if (!date) return badRequest('Parâmetro "date" inválido (AAAA-MM-DD, entre 1995 e hoje).')

  const numberingRaw = url.searchParams.get('numbering') ?? 'index'
  if (!['index', 'dc', 'du'].includes(numberingRaw)) {
    return badRequest('Parâmetro "numbering" inválido (index, dc ou du).')
  }
  const numbering = numberingRaw as SapNumbering
  const include = (url.searchParams.get('include') ?? '').split(',').map((s) => s.trim())
  const header = url.searchParams.get('header') === '1'
  const separator = url.searchParams.get('sep') ?? ';'

  const ratesParam = url.searchParams.get('rates')
  let rateCodes: string[]
  let fetchIfMissing: boolean
  if (ratesParam) {
    const parsed = ratesParam.split(',').map((r) => parseRateCode(r))
    if (parsed.some((r) => r === null)) {
      return badRequest('Parâmetro "rates" inválido (lista de códigos como PRE,DIC).')
    }
    rateCodes = [...new Set(parsed as string[])]
    fetchIfMissing = true
  } else {
    const active = await prisma.rateType.findMany({
      where: { active: true, code: { not: { startsWith: '_' } } },
      select: { code: true },
      orderBy: { code: 'asc' },
    })
    rateCodes = active.map((r) => r.code)
    fetchIfMissing = false
  }

  try {
    const duCache = new Map<number, number>()
    const duForDc = (dc: number): number => {
      let du = duCache.get(dc)
      if (du === undefined) {
        du = businessDaysForCalendarDays(date, dc)
        duCache.set(dc, du)
      }
      return du
    }

    const chunks: string[] = []
    const exported: string[] = []
    const skipped: string[] = []
    for (const rate of rateCodes) {
      const payload = await ensureCurve(rate, date, { fetchIfMissing })
      if (payload.status !== 'OK' || payload.points.length === 0) {
        skipped.push(rate)
        continue
      }
      const { content } = buildSapCurveExport(rate, date, payload.points, {
        numbering,
        separator,
        header: header && chunks.length === 0,
        includeDc: include.includes('dc'),
        includeDu: include.includes('du'),
        duForDc,
      })
      chunks.push(content)
      exported.push(rate)
    }

    if (exported.length === 0) {
      return NextResponse.json(
        { error: 'Nenhuma curva com dados para a data.', date, skipped },
        { status: 404 },
      )
    }

    const filename = `sap_curvas_${exported.length === 1 ? exported[0] + '_' : ''}${date.replaceAll('-', '')}.csv`
    return new NextResponse(chunks.join(''), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Exported-Rates': exported.join(','),
        'X-Skipped-Rates': skipped.join(','),
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
