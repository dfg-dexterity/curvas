import { NextResponse } from 'next/server'
import { runDailyJob } from '../../../../lib/ingest'

export const dynamic = 'force-dynamic'
// Ingestão de ~17 taxas × até 5 dias pode demorar; exige plano com suporte
// (no Hobby a execução é limitada — o job é idempotente e converge em
// execuções seguidas mesmo se interrompido).
export const maxDuration = 300

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV === 'development'
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true
  return new URL(req.url).searchParams.get('secret') === secret
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const result = await runDailyJob()
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
