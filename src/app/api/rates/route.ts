import { NextResponse } from 'next/server'
import { latestExpectedDataDate } from '../../../lib/dates'
import { prisma } from '../../../lib/db'
import { ensureRateTypesSeeded } from '../../../lib/ingest'

export const dynamic = 'force-dynamic'

interface CoverageRow {
  rateCode: string
  dates: number
  from: string
  to: string
}

/** Lista as taxas conhecidas e a cobertura de dados de cada uma no banco. */
export async function GET() {
  try {
    // Primeira execução: semeia a lista de taxas para a UI funcionar de cara
    // (o job diário substitui pela lista real descoberta na B3).
    await ensureRateTypesSeeded()

    const [rates, coverage] = await Promise.all([
      prisma.rateType.findMany({ orderBy: [{ active: 'desc' }, { code: 'asc' }] }),
      prisma.$queryRaw<CoverageRow[]>`
        SELECT "rateCode",
               COUNT(DISTINCT "date")::int AS "dates",
               to_char(MIN("date"), 'YYYY-MM-DD') AS "from",
               to_char(MAX("date"), 'YYYY-MM-DD') AS "to"
        FROM "CurvePoint"
        GROUP BY "rateCode"
      `,
    ])

    const coverageByCode = new Map(coverage.map((c) => [c.rateCode, c]))
    let latestDate: string | null = null
    for (const c of coverage) {
      if (!latestDate || c.to > latestDate) latestDate = c.to
    }

    return NextResponse.json({
      latestDate,
      latestExpected: latestExpectedDataDate(),
      rates: rates.map((rate) => {
        const c = coverageByCode.get(rate.code)
        return {
          code: rate.code,
          name: rate.name,
          active: rate.active,
          coverage: c ? { dates: c.dates, from: c.from, to: c.to } : null,
        }
      }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
