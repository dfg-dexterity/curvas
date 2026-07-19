import { fetchRatesPage } from './b3/client'
import { SEED_RATES } from './b3/seed-rates'
import type { ParsedRatesPage, RateOption } from './b3/types'
import { mapWithConcurrency } from './concurrency'
import { businessDaysBetween, lastBusinessDays, latestExpectedDataDate, toISO, toUTCDate } from './dates'
import { prisma } from './db'
import type { FetchStatus } from '../generated/prisma/enums'

/** Depois deste prazo, um EMPTY é definitivo (feriado/data sem publicação). */
const EMPTY_AUTHORITATIVE_AFTER_DAYS = 7
/** Espera mínima antes de reconsultar a B3 para uma data recém-vazia. */
const EMPTY_RETRY_COOLDOWN_MS = 30 * 60 * 1000
/** Espera mínima antes de reconsultar após um erro. */
const ERROR_RETRY_COOLDOWN_MS = 2 * 60 * 1000

export function fetchConcurrency(): number {
  const n = Number.parseInt(process.env.B3_FETCH_CONCURRENCY ?? '', 10)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 4
}

export interface StoreResult {
  status: FetchStatus
  points: number
  message?: string
  /** Opções do dropdown vistas nesta página (para sincronização oportunista). */
  options: RateOption[]
}

export interface CurvePointJSON {
  days: number
  rate252: number | null
  rate360: number | null
}

export interface CurvePayload {
  rate: { code: string; name: string }
  date: string
  status: FetchStatus | 'MISSING'
  source: 'db' | 'b3' | 'none'
  points: CurvePointJSON[]
  message?: string
  /** Data mais recente ≤ solicitada com dados, sugerida quando vazio. */
  nearestAvailable?: string
}

function jitter(maxMs = 250): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.random() * maxMs))
}

/** Insere a lista-semente apenas se o banco ainda não conhece nenhuma taxa. */
export async function ensureRateTypesSeeded(options?: RateOption[]): Promise<void> {
  const count = await prisma.rateType.count()
  if (count > 0) return
  const list = options && options.length >= 3 ? options : SEED_RATES
  await prisma.rateType.createMany({
    data: list.map(({ code, name }) => ({ code, name })),
    skipDuplicates: true,
  })
}

/**
 * Sincroniza a tabela RateType com o dropdown da B3: insere novidades,
 * atualiza nomes e desativa códigos que saíram da lista. Só roda com uma
 * lista plausível (≥ 3 opções) para não desativar tudo por falha de parse.
 */
export async function syncRateTypes(options: RateOption[]): Promise<void> {
  if (options.length < 3) return
  const now = new Date()
  const codes = options.map((o) => o.code)

  await prisma.$transaction([
    ...options.map(({ code, name }) =>
      prisma.rateType.upsert({
        where: { code },
        create: { code, name, active: true, firstSeenAt: now, lastSeenAt: now },
        update: { name, active: true, lastSeenAt: now },
      }),
    ),
    prisma.rateType.updateMany({
      where: { code: { notIn: codes }, active: true },
      data: { active: false },
    }),
  ])
}

async function writeFetchLog(
  rateCode: string,
  date: Date,
  status: FetchStatus,
  points: number,
  message?: string,
): Promise<void> {
  await prisma.fetchLog.upsert({
    where: { rateCode_date: { rateCode, date } },
    create: { rateCode, date, status, points, message: message ?? null },
    update: { status, points, message: message ?? null, fetchedAt: new Date() },
  })
}

/** Garante a existência do RateType (FK) antes de gravar pontos/logs. */
async function ensureRateTypeExists(rateCode: string): Promise<void> {
  await prisma.rateType.upsert({
    where: { code: rateCode },
    create: { code: rateCode, name: rateCode },
    update: {},
  })
}

/** Persiste uma página já interpretada para (taxa, data). */
export async function storeParsedCurve(
  rateCode: string,
  dateISO: string,
  parsed: ParsedRatesPage,
): Promise<StoreResult> {
  const date = toUTCDate(dateISO)
  await ensureRateTypeExists(rateCode)

  if (parsed.rows.length === 0) {
    if (parsed.emptyReason) {
      // Vazio "oficial": a B3 informou que não há dados para a data.
      await writeFetchLog(rateCode, date, 'EMPTY', 0, parsed.emptyReason)
      return { status: 'EMPTY', points: 0, message: parsed.emptyReason, options: parsed.options }
    }
    // Página reconhecida, mas sem tabela nem mensagem de vazio: pode ser
    // mudança de estrutura ou publicação pendente — classifica como erro
    // re-tentável em vez de vazio definitivo.
    const message = 'Página sem tabela de vértices e sem mensagem de vazio (estrutura mudou?).'
    await writeFetchLog(rateCode, date, 'ERROR', 0, message)
    return { status: 'ERROR', points: 0, message, options: parsed.options }
  }

  await prisma.$transaction([
    prisma.curvePoint.deleteMany({ where: { rateCode, date } }),
    prisma.curvePoint.createMany({
      data: parsed.rows.map((row) => ({
        rateCode,
        date,
        days: row.days,
        rate252: row.rate252,
        rate360: row.rate360,
      })),
    }),
  ])

  const warn = parsed.warnings.length ? parsed.warnings.join(' | ') : undefined
  await writeFetchLog(rateCode, date, 'OK', parsed.rows.length, warn)
  return { status: 'OK', points: parsed.rows.length, message: warn, options: parsed.options }
}

/** Consulta a B3 e persiste a curva de (taxa, data), registrando o resultado. */
export async function fetchAndStoreCurve(rateCode: string, dateISO: string): Promise<StoreResult> {
  try {
    const parsed = await fetchRatesPage(rateCode, dateISO)
    return await storeParsedCurve(rateCode, dateISO, parsed)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    try {
      await ensureRateTypeExists(rateCode)
      await writeFetchLog(rateCode, toUTCDate(dateISO), 'ERROR', 0, message.slice(0, 500))
    } catch {
      // registro de log é melhor-esforço; o erro original prevalece
    }
    return { status: 'ERROR', points: 0, message, options: [] }
  }
}

function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function readCurvePoints(rateCode: string, date: Date): Promise<CurvePointJSON[]> {
  const points = await prisma.curvePoint.findMany({
    where: { rateCode, date },
    orderBy: { days: 'asc' },
    select: { days: true, rate252: true, rate360: true },
  })
  return points.map((p) => ({
    days: p.days,
    rate252: decimalToNumber(p.rate252),
    rate360: decimalToNumber(p.rate360),
  }))
}

async function nearestAvailableDate(rateCode: string, beforeISO: string): Promise<string | undefined> {
  const point = await prisma.curvePoint.findFirst({
    where: { rateCode, date: { lte: toUTCDate(beforeISO) } },
    orderBy: { date: 'desc' },
    select: { date: true },
  })
  return point ? toISO(point.date) : undefined
}

/**
 * Retorna a curva de (taxa, data). Se não estiver no banco e a data já puder
 * ter publicação, consulta a B3 na hora e grava — é isso que permite consultar
 * QUALQUER data retroativa sem precisar de backfill prévio.
 */
export async function ensureCurve(
  rateCode: string,
  dateISO: string,
  opts: { fetchIfMissing?: boolean } = {},
): Promise<CurvePayload> {
  const fetchIfMissing = opts.fetchIfMissing ?? true
  const rateType = await prisma.rateType.findUnique({ where: { code: rateCode } })
  const rate = { code: rateCode, name: rateType?.name ?? rateCode }
  const date = toUTCDate(dateISO)

  const fromDb = await readCurvePoints(rateCode, date)
  if (fromDb.length > 0) {
    return { rate, date: dateISO, status: 'OK', source: 'db', points: fromDb }
  }

  const log = await prisma.fetchLog.findUnique({ where: { rateCode_date: { rateCode, date } } })
  const ageMs = log ? Date.now() - log.fetchedAt.getTime() : Infinity
  const isOldDate = dateISO < toISO(new Date(Date.now() - EMPTY_AUTHORITATIVE_AFTER_DAYS * 86_400_000))

  let canFetch = fetchIfMissing && dateISO <= latestExpectedDataDate()
  if (log?.status === 'EMPTY' && (isOldDate || ageMs < EMPTY_RETRY_COOLDOWN_MS)) canFetch = false
  if (log?.status === 'ERROR' && ageMs < ERROR_RETRY_COOLDOWN_MS) canFetch = false

  if (canFetch) {
    const result = await fetchAndStoreCurve(rateCode, dateISO)
    if (result.status === 'OK') {
      return {
        rate,
        date: dateISO,
        status: 'OK',
        source: 'b3',
        points: await readCurvePoints(rateCode, date),
        message: result.message,
      }
    }
    return {
      rate,
      date: dateISO,
      status: result.status,
      source: 'b3',
      points: [],
      message: result.message,
      nearestAvailable: await nearestAvailableDate(rateCode, dateISO),
    }
  }

  return {
    rate,
    date: dateISO,
    status: log?.status ?? 'MISSING',
    source: 'none',
    points: [],
    message: log?.message ?? undefined,
    nearestAvailable: await nearestAvailableDate(rateCode, dateISO),
  }
}

export interface BackfillProgress {
  date: string
  ok: number
  empty: number
  error: number
  skipped: number
}

/**
 * Preenche o histórico de um intervalo de datas (dias úteis), taxa a taxa.
 * Reexecutável: pares (taxa, data) já capturados com sucesso são pulados,
 * então é seguro interromper e retomar.
 */
export async function backfillRange(opts: {
  from: string
  to: string
  rateCodes?: string[]
  concurrency?: number
  onDateDone?: (progress: BackfillProgress) => void
}): Promise<{ dates: number; ok: number; empty: number; error: number; skipped: number }> {
  const dates = businessDaysBetween(opts.from, opts.to)
  const concurrency = opts.concurrency ?? fetchConcurrency()

  // Garante que exista uma lista de taxas (descoberta ou semente).
  let rateCodes = opts.rateCodes
  if (!rateCodes || rateCodes.length === 0) {
    if ((await prisma.rateType.count()) === 0) {
      try {
        const parsed = await fetchRatesPage('PRE', latestExpectedDataDate())
        await syncRateTypes(parsed.options)
      } catch {
        // sem rede/parse: cai na semente abaixo
      }
      await ensureRateTypesSeeded()
    }
    const active = await prisma.rateType.findMany({ where: { active: true }, select: { code: true } })
    rateCodes = active.map((r) => r.code)
  }

  const totals = { dates: dates.length, ok: 0, empty: 0, error: 0, skipped: 0 }

  for (const date of dates) {
    const logs = await prisma.fetchLog.findMany({
      where: { date: toUTCDate(date), rateCode: { in: rateCodes } },
      select: { rateCode: true, status: true },
    })
    const done = new Set(logs.filter((l) => l.status === 'OK').map((l) => l.rateCode))
    const emptyKnown = new Set(logs.filter((l) => l.status === 'EMPTY').map((l) => l.rateCode))

    const progress: BackfillProgress = { date, ok: 0, empty: 0, error: 0, skipped: 0 }
    const pending = rateCodes.filter((code) => {
      const skip = done.has(code) || emptyKnown.has(code)
      if (skip) progress.skipped++
      return !skip
    })

    const results = await mapWithConcurrency(pending, concurrency, async (code) => {
      await jitter()
      return fetchAndStoreCurve(code, date)
    })
    for (const result of results) {
      if (result.status === 'OK') progress.ok++
      else if (result.status === 'EMPTY') progress.empty++
      else progress.error++
    }

    totals.ok += progress.ok
    totals.empty += progress.empty
    totals.error += progress.error
    totals.skipped += progress.skipped
    opts.onDateDone?.(progress)
  }

  return totals
}

export interface JobResult {
  startedAt: string
  finishedAt: string
  durationMs: number
  discovery: { ok: boolean; optionsFound: number; message?: string }
  targetDates: string[]
  rates: number
  attempted: number
  ok: number
  empty: number
  error: number
  skipped: number
  errors: Array<{ rateCode: string; date: string; message?: string }>
}

/**
 * Job diário idempotente:
 * 1. Rediscobre a lista de taxas no dropdown da B3 (e aproveita o HTML para
 *    ingerir a curva PRE do dia).
 * 2. Para cada dia útil recente ainda não capturado com sucesso, busca todas
 *    as taxas ativas. EMPTYs antigos são considerados definitivos.
 * Rodar mais de uma vez por dia é seguro; execuções interrompidas convergem.
 */
export async function runDailyJob(
  opts: { catchupBdays?: number; endDateISO?: string } = {},
): Promise<JobResult> {
  const startedAt = new Date()
  const envCatchup = Number.parseInt(process.env.JOB_CATCHUP_BDAYS ?? '', 10)
  const catchup =
    opts.catchupBdays ?? (Number.isFinite(envCatchup) && envCatchup > 0 ? envCatchup : 5)
  const end = opts.endDateISO ?? latestExpectedDataDate()
  const dates = lastBusinessDays(Math.min(catchup, 30), end)

  // 1. Descoberta da lista de taxas (não-fatal em caso de falha).
  const discovery: JobResult['discovery'] = { ok: false, optionsFound: 0 }
  try {
    const parsed = await fetchRatesPage('PRE', end)
    await syncRateTypes(parsed.options)
    await ensureRateTypesSeeded(parsed.options)
    await storeParsedCurve('PRE', end, parsed)
    discovery.ok = true
    discovery.optionsFound = parsed.options.length
  } catch (err) {
    discovery.message = err instanceof Error ? err.message : String(err)
    await ensureRateTypesSeeded()
  }

  const rates = await prisma.rateType.findMany({ where: { active: true }, select: { code: true } })

  // 2. Seleciona alvos ainda pendentes.
  const logs = await prisma.fetchLog.findMany({
    where: { date: { in: dates.map(toUTCDate) } },
    select: { rateCode: true, date: true, status: true },
  })
  const logByKey = new Map(logs.map((l) => [`${l.rateCode}|${toISO(l.date)}`, l.status]))
  const oldCutoff = toISO(new Date(Date.now() - EMPTY_AUTHORITATIVE_AFTER_DAYS * 86_400_000))

  const targets: Array<{ rateCode: string; date: string }> = []
  let skipped = 0
  for (const date of dates) {
    for (const { code } of rates) {
      // A curva PRE do dia mais recente acabou de ser processada na descoberta.
      if (discovery.ok && code === 'PRE' && date === end) {
        skipped++
        continue
      }
      const status = logByKey.get(`${code}|${date}`)
      if (status === 'OK' || (status === 'EMPTY' && date < oldCutoff)) {
        skipped++
        continue
      }
      targets.push({ rateCode: code, date })
    }
  }

  // 3. Executa com concorrência limitada e um pequeno jitter (cortesia com a B3).
  const results = await mapWithConcurrency(targets, fetchConcurrency(), async (target) => {
    await jitter()
    const result = await fetchAndStoreCurve(target.rateCode, target.date)
    return { ...target, ...result }
  })

  const finishedAt = new Date()
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    discovery,
    targetDates: dates,
    rates: rates.length,
    attempted: targets.length,
    ok: results.filter((r) => r.status === 'OK').length,
    empty: results.filter((r) => r.status === 'EMPTY').length,
    error: results.filter((r) => r.status === 'ERROR').length,
    skipped,
    errors: results
      .filter((r) => r.status === 'ERROR')
      .map(({ rateCode, date, message }) => ({ rateCode, date, message })),
  }
}
