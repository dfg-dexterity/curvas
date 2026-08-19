'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CurveChart, type CurveSeries } from '../components/CurveChart'
import { CurveTable } from '../components/CurveTable'
import { HistoryChart, type HistoryPoint } from '../components/HistoryChart'
import { InterpolatePanel } from '../components/InterpolatePanel'
import { MethodsInfo } from '../components/MethodsInfo'
import { MAX_COMPARE, useVizTheme } from '../components/theme'
import { availableBases, interpolateAt, type RateBase } from '../lib/curve-math'
import { fmtDelta, fmtValue, isRateKind, valueKindFor, valueUnitLabel } from '../lib/curves/value-kind'
import { addDays, isBusinessDay, previousBusinessDay } from '../lib/dates'
import { fmtDateBr, fmtDateShortBr, fmtDaysLabel } from '../lib/format'
import type { CurvePayload } from '../lib/ingest'

interface RateInfo {
  code: string
  name: string
  active: boolean
  coverage: { dates: number; from: string; to: string } | null
}

interface RatesResponse {
  latestDate: string | null
  latestExpected: string
  rates: RateInfo[]
}

interface Selection {
  date: string
  slot: number
}

const KEY_TERMS = [
  { days: 30, label: '1 mês' },
  { days: 91, label: '3 meses' },
  { days: 182, label: '6 meses' },
  { days: 365, label: '1 ano' },
  { days: 730, label: '2 anos' },
  { days: 1825, label: '5 anos' },
  { days: 3650, label: '10 anos' },
]

const QUICK_COMPARES = [
  { label: '−1 sem', days: 7 },
  { label: '−1 mês', days: 30 },
  { label: '−6 meses', days: 182 },
  { label: '−1 ano', days: 365 },
  { label: '−5 anos', days: 1826 },
]

/** Horizontes de exibição do gráfico principal (dias corridos; null = tudo). */
const CHART_HORIZONS: Array<{ label: string; days: number | null }> = [
  { label: '6 meses', days: 182 },
  { label: '1 ano', days: 365 },
  { label: '2 anos', days: 730 },
  { label: '5 anos', days: 1826 },
  { label: '10 anos', days: 3652 },
  { label: 'Tudo', days: null },
]

const HISTORY_TERMS = [30, 91, 182, 365, 730, 1825, 3650]
const HISTORY_WINDOWS = [
  { label: '6 meses', days: 182 },
  { label: '1 ano', days: 365 },
  { label: '2 anos', days: 730 },
  { label: '5 anos', days: 1826 },
  { label: '10 anos', days: 3652 },
]

/** Ajusta uma data qualquer para o dia útil B3 mais próximo (para trás). */
function snapToBusinessDay(iso: string): string {
  return isBusinessDay(iso) ? iso : previousBusinessDay(iso)
}

export default function Home() {
  const theme = useVizTheme()

  const [ratesResp, setRatesResp] = useState<RatesResponse | null>(null)
  const [ratesError, setRatesError] = useState<string | null>(null)

  const [rateCode, setRateCode] = useState<string>('PRE')
  const [selections, setSelections] = useState<Selection[]>([])
  const [base, setBase] = useState<RateBase>('rate252')
  // Horizonte do gráfico principal — por padrão até 1 ano (o miolo líquido da
  // curva); "Tudo" mostra os ~34 anos publicados.
  const [chartHorizon, setChartHorizon] = useState<number | null>(365)

  // Resultado de fetch "keyed": loading é derivado (chave desejada ≠ resolvida),
  // sem setState síncrono em effects, e o render anterior fica em quadro.
  const [curvesResult, setCurvesResult] = useState<{
    key: string
    map: Record<string, CurvePayload>
    error?: string
  } | null>(null)

  const [historyDays, setHistoryDays] = useState(365)
  const [historyWindow, setHistoryWindow] = useState(365)
  const [historyResult, setHistoryResult] = useState<{
    key: string
    series: Array<{ date: string; rate252: number | null; rate360: number | null }>
  } | null>(null)

  // Carga inicial: lista de taxas + data padrão (última com dados).
  useEffect(() => {
    let cancelled = false
    fetch('/api/rates')
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
        return body as RatesResponse
      })
      .then((body) => {
        if (cancelled) return
        setRatesResp(body)
        const initial =
          body.rates.find((r) => r.code === 'PRE') ??
          body.rates.find((r) => r.coverage !== null) ??
          body.rates[0]
        if (!initial) {
          setRatesError('Nenhuma taxa cadastrada. Rode o job diário para descobrir a lista na B3.')
          return
        }
        setRateCode(initial.code)
        const date = initial.coverage?.to ?? body.latestDate ?? snapToBusinessDay(body.latestExpected)
        setSelections([{ date, slot: 0 }])
      })
      .catch((err) => !cancelled && setRatesError(err instanceof Error ? err.message : String(err)))
    return () => {
      cancelled = true
    }
  }, [])

  const datesCsv = selections.map((s) => s.date).join(',')
  const curvesKey = `${rateCode}|${datesCsv}`
  const primaryDate = selections[0]?.date

  // Busca as curvas selecionadas (com retro-busca sob demanda no servidor).
  useEffect(() => {
    if (!datesCsv) return
    let cancelled = false
    fetch(`/api/curves/compare?rate=${rateCode}&dates=${datesCsv}`)
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
        return body as { curves: CurvePayload[] }
      })
      .then((body) => {
        if (cancelled) return
        const map: Record<string, CurvePayload> = {}
        for (const curve of body.curves) map[curve.date] = curve
        setCurvesResult({ key: `${rateCode}|${datesCsv}`, map })
      })
      .catch((err) => {
        if (cancelled) return
        setCurvesResult((prev) => ({
          key: `${rateCode}|${datesCsv}`,
          map: prev?.map ?? {},
          error: err instanceof Error ? err.message : String(err),
        }))
      })
    return () => {
      cancelled = true
    }
  }, [rateCode, datesCsv])

  const historyKey = `${rateCode}|${historyDays}|${historyWindow}|${primaryDate ?? ''}`

  // Histórico do prazo escolhido (a base é filtrada no render, sem refetch).
  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ rate: rateCode, days: String(historyDays) })
    if (primaryDate) {
      params.set('to', primaryDate)
      params.set('from', addDays(primaryDate, -historyWindow))
    }
    const key = `${rateCode}|${historyDays}|${historyWindow}|${primaryDate ?? ''}`
    fetch(`/api/history?${params.toString()}`)
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
        return body as {
          series: Array<{ date: string; rate252: number | null; rate360: number | null }>
        }
      })
      .then((body) => {
        if (!cancelled) setHistoryResult({ key, series: body.series })
      })
      .catch(() => {
        if (!cancelled) setHistoryResult({ key, series: [] })
      })
    return () => {
      cancelled = true
    }
  }, [rateCode, historyDays, historyWindow, primaryDate])

  const curves = useMemo(() => curvesResult?.map ?? {}, [curvesResult])
  const curvesLoading = Boolean(datesCsv) && curvesResult?.key !== curvesKey
  const curvesError = curvesResult?.key === curvesKey ? curvesResult.error : undefined
  const historyLoading = historyResult?.key !== historyKey

  const primary = selections[0]
  const primaryCurve = primary ? curves[primary.date] : undefined

  // Base disponível conforme a curva (algumas publicam só 252 ou só 360).
  const bases = useMemo(() => {
    const points = primaryCurve?.points ?? Object.values(curves)[0]?.points ?? []
    return availableBases(points)
  }, [primaryCurve, curves])

  // Preferência do usuário corrigida pelo que a curva realmente publica.
  const effectiveBase: RateBase = useMemo(() => {
    if (base === 'rate252' && !bases.has252 && bases.has360) return 'rate360'
    if (base === 'rate360' && !bases.has360 && bases.has252) return 'rate252'
    return base
  }, [base, bases])

  const history: HistoryPoint[] = useMemo(
    () =>
      (historyResult?.series ?? [])
        .filter((p) => p[effectiveBase] !== null)
        .map((p) => ({ date: p.date, value: p[effectiveBase] as number })),
    [historyResult, effectiveBase],
  )

  const setPrimaryDate = useCallback((iso: string) => {
    if (!iso) return
    const date = snapToBusinessDay(iso)
    setSelections((prev) => {
      if (prev.some((s) => s.date === date)) return prev
      const [first, ...rest] = prev
      return [{ date, slot: first?.slot ?? 0 }, ...rest]
    })
  }, [])

  const addCompare = useCallback((iso: string) => {
    const date = snapToBusinessDay(iso)
    setSelections((prev) => {
      if (prev.length >= MAX_COMPARE || prev.some((s) => s.date === date)) return prev
      const used = new Set(prev.map((s) => s.slot))
      let slot = 0
      while (used.has(slot)) slot++
      return [...prev, { date, slot }]
    })
  }, [])

  const removeCompare = useCallback((date: string) => {
    setSelections((prev) => (prev[0]?.date === date ? prev : prev.filter((s) => s.date !== date)))
  }, [])

  const valueKind = valueKindFor(rateCode)

  const series: CurveSeries[] = selections.map((s) => ({
    date: s.date,
    slot: s.slot,
    points: (curves[s.date]?.points ?? []).filter(
      (p) => chartHorizon === null || p.days <= chartHorizon,
    ),
  }))

  const oldestCompare = useMemo(() => {
    if (selections.length < 2) return undefined
    return [...selections].sort((a, b) => (a.date < b.date ? -1 : 1))[0]
  }, [selections])

  const selectedRate = ratesResp?.rates.find((r) => r.code === rateCode)
  const problems = selections
    .map((s) => curves[s.date])
    .filter((c): c is CurvePayload => Boolean(c && c.status !== 'OK'))

  if (ratesError) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-24">
        <div className="card px-6 py-8">
          <h1 className="text-lg font-semibold">Não foi possível iniciar</h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--ink-2)' }}>
            {ratesError}
          </p>
          <p className="mt-4 text-sm" style={{ color: 'var(--muted)' }}>
            Verifique se o Postgres está de pé (<code>npm run db:up</code>), migrado (
            <code>npm run db:migrate</code>) e se <code>DATABASE_URL</code> está configurada.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid h-8 w-8 place-items-center rounded-lg text-sm font-bold text-white"
              style={{ background: 'var(--accent)' }}
            >
              %
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">Curvas de Juros — B3</h1>
          </div>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            Taxas Referenciais BM&F, atualizadas diariamente e consultáveis para qualquer data desde 1995
          </p>
        </div>
        {ratesResp && (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Último dado no banco: {ratesResp.latestDate ? fmtDateBr(ratesResp.latestDate) : '—'}
          </p>
        )}
      </header>

      {/* Linha única de filtros, acima de todo o conteúdo que ela controla */}
      <section className="mb-4 flex flex-wrap items-center gap-2" aria-label="Filtros">
        <select
          value={rateCode}
          onChange={(e) => setRateCode(e.target.value)}
          className="control cursor-pointer"
          aria-label="Taxa referencial"
        >
          {(ratesResp?.rates ?? []).map((rate) => (
            <option key={rate.code} value={rate.code}>
              {rate.code} — {rate.name}
              {rate.active ? '' : ' (descontinuada)'}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={primary?.date ?? ''}
          min="1995-01-01"
          max={ratesResp ? snapToBusinessDay(ratesResp.latestExpected) : undefined}
          onChange={(e) => setPrimaryDate(e.target.value)}
          className="control cursor-pointer"
          aria-label="Data de referência"
        />

        {bases.has252 && bases.has360 && (
          <div role="group" aria-label="Base da taxa" className="control flex gap-0 p-0.5">
            {(['rate252', 'rate360'] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBase(b)}
                className="cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium"
                style={
                  effectiveBase === b
                    ? { background: 'var(--accent)', color: '#fff' }
                    : { color: 'var(--ink-2)' }
                }
              >
                {b === 'rate252' ? '252 du' : '360 dc'}
              </button>
            ))}
          </div>
        )}

        <span className="mx-1 text-xs" style={{ color: 'var(--muted)' }}>
          comparar com:
        </span>
        {QUICK_COMPARES.map((quick) => (
          <button
            key={quick.label}
            type="button"
            disabled={!primary || selections.length >= MAX_COMPARE}
            onClick={() => primary && addCompare(addDays(primary.date, -quick.days))}
            className="chip cursor-pointer hover:opacity-75 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ color: 'var(--ink-2)' }}
          >
            {quick.label}
          </button>
        ))}
        <input
          type="date"
          min="1995-01-01"
          max={primary?.date}
          value=""
          onChange={(e) => e.target.value && addCompare(e.target.value)}
          className="control cursor-pointer text-xs"
          aria-label="Adicionar data de comparação"
        />
      </section>

      {/* Avisos de captura (feriado, dado ainda não publicado, erro na B3) */}
      {(curvesError || problems.length > 0) && (
        <div className="card mb-4 px-4 py-3 text-sm" role="status">
          {curvesError && <p>⚠ {curvesError}</p>}
          {problems.map((p) => (
            <p key={p.date} style={{ color: 'var(--ink-2)' }}>
              ⚠ {fmtDateBr(p.date)}:{' '}
              {p.status === 'EMPTY'
                ? 'sem dados na B3 (feriado ou publicação ainda pendente)'
                : (p.message ?? 'falha na captura')}
              {p.nearestAvailable && (
                <button
                  type="button"
                  className="chip ml-2 cursor-pointer hover:opacity-75"
                  onClick={() => {
                    if (primary?.date === p.date) {
                      setPrimaryDate(p.nearestAvailable as string)
                    } else {
                      removeCompare(p.date)
                      addCompare(p.nearestAvailable as string)
                    }
                  }}
                >
                  usar {fmtDateBr(p.nearestAvailable)}
                </button>
              )}
            </p>
          ))}
        </div>
      )}

      {/* Consulta principal: taxa interpolada em qualquer data (Manual B3) */}
      <InterpolatePanel rateCode={rateCode} date={selections[0]?.date} />

      {/* Vértices-chave da data principal */}
      {primaryCurve && primaryCurve.points.length > 0 && (
        <section
          className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"
          aria-label="Vértices-chave"
        >
          {KEY_TERMS.map((term) => {
            const value = interpolateAt(primaryCurve.points, term.days, effectiveBase)
            const compareCurve =
              oldestCompare && oldestCompare.date !== primary?.date ? curves[oldestCompare.date] : undefined
            const compareValue = compareCurve
              ? interpolateAt(compareCurve.points, term.days, effectiveBase)
              : null
            const delta = value !== null && compareValue !== null ? value - compareValue : null
            return (
              <div key={term.days} className="card px-3 py-2.5">
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  {term.label}
                </p>
                <p className="text-lg font-semibold tabular-nums">{fmtValue(valueKind, value)}</p>
                {delta !== null && oldestCompare && (
                  <p className="text-[11px]" style={{ color: 'var(--ink-2)' }}>
                    {delta >= 0 ? '↑' : '↓'} {fmtDelta(valueKind, delta)} vs{' '}
                    {fmtDateShortBr(oldestCompare.date)}
                  </p>
                )}
              </div>
            )
          })}
        </section>
      )}

      {/* Gráfico principal */}
      <section className="card mb-4 px-4 pb-3 pt-4">
        <header className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
          <div>
            <h2 className="text-sm font-semibold">
              {selectedRate ? `${selectedRate.name} (${selectedRate.code})` : rateCode} — estrutura a termo,{' '}
              {isRateKind(valueKind)
                ? valueUnitLabel(effectiveBase === 'rate252' ? 'rate252' : 'rate360')
                : valueUnitLabel(valueKind)}
            </h2>
            {curvesLoading && (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                atualizando…
              </p>
            )}
          </div>
          {/* Legenda-chip: canal de identidade permanente (e gestão da comparação) */}
          <ul className="flex flex-wrap items-center gap-1.5" aria-label="Datas exibidas">
            {selections.map((s, i) => (
              <li
                key={s.date}
                className="chip flex items-center gap-1.5"
                style={i === 0 ? { borderColor: 'var(--accent)' } : undefined}
              >
                <span
                  aria-hidden
                  className="inline-block h-0.5 w-3"
                  style={{ background: theme.series[s.slot % theme.series.length] }}
                />
                <span style={{ color: 'var(--ink-2)' }}>{fmtDateBr(s.date)}</span>
                {i > 0 && (
                  <button
                    type="button"
                    onClick={() => removeCompare(s.date)}
                    aria-label={`Remover ${fmtDateBr(s.date)}`}
                    className="cursor-pointer hover:opacity-70"
                    style={{ color: 'var(--muted)' }}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        </header>
        <div
          role="group"
          aria-label="Horizonte do gráfico"
          className="mb-1 flex flex-wrap items-center gap-1.5 px-1"
        >
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            horizonte:
          </span>
          {CHART_HORIZONS.map((h) => (
            <button
              key={h.label}
              type="button"
              onClick={() => setChartHorizon(h.days)}
              className="chip cursor-pointer hover:opacity-75"
              style={
                chartHorizon === h.days
                  ? { borderColor: 'var(--accent)', color: 'var(--accent)', fontWeight: 600 }
                  : { color: 'var(--ink-2)' }
              }
            >
              {h.label}
            </button>
          ))}
        </div>
        <CurveChart
          series={series}
          base={effectiveBase}
          theme={theme}
          valueKind={valueKind}
          loading={curvesLoading}
        />
      </section>

      {/* Histórico de um prazo + informações da taxa */}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <section className="card px-4 pb-2 pt-4">
          <header className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <h2 className="text-sm font-semibold">Histórico do prazo</h2>
            <div className="flex gap-2">
              <select
                value={historyDays}
                onChange={(e) => setHistoryDays(Number(e.target.value))}
                className="control cursor-pointer text-xs"
                aria-label="Prazo do histórico"
              >
                {HISTORY_TERMS.map((d) => (
                  <option key={d} value={d}>
                    {fmtDaysLabel(d)} ({d} dc)
                  </option>
                ))}
              </select>
              <select
                value={historyWindow}
                onChange={(e) => setHistoryWindow(Number(e.target.value))}
                className="control cursor-pointer text-xs"
                aria-label="Janela do histórico"
              >
                {HISTORY_WINDOWS.map((w) => (
                  <option key={w.days} value={w.days}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>
          </header>
          <HistoryChart points={history} theme={theme} valueKind={valueKind} loading={historyLoading} />
          <p className="px-1 pb-2 pt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
            Interpolação linear entre vértices; usa apenas datas já armazenadas no banco.
          </p>
        </section>

        <section className="card px-5 py-4">
          <h2 className="text-sm font-semibold">Sobre esta taxa</h2>
          {selectedRate ? (
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt style={{ color: 'var(--muted)' }}>Código B3 (slcTaxa)</dt>
                <dd className="font-medium">{selectedRate.code}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt style={{ color: 'var(--muted)' }}>Situação</dt>
                <dd>{selectedRate.active ? 'listada na B3' : 'fora da lista atual (histórico preservado)'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt style={{ color: 'var(--muted)' }}>Cobertura no banco</dt>
                <dd className="text-right">
                  {selectedRate.coverage
                    ? `${fmtDateBr(selectedRate.coverage.from)} a ${fmtDateBr(selectedRate.coverage.to)} · ${selectedRate.coverage.dates.toLocaleString('pt-BR')} datas`
                    : 'nenhuma data ainda'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>
              Carregando…
            </p>
          )}
        </section>
      </div>

      {/* Tabela com os vértices originais */}
      {primary && primaryCurve && (
        <CurveTable
          rateCode={rateCode}
          date={primary.date}
          points={primaryCurve.points}
          has252={bases.has252}
          has360={bases.has360}
        />
      )}

      {/* Referência: regra de interpolação de cada curva */}
      <MethodsInfo
        rateNames={Object.fromEntries((ratesResp?.rates ?? []).map((r) => [r.code, r.name]))}
      />

      <footer className="mt-8 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
        <p>
          Fonte: B3 — Taxas Referenciais BM&F (
          <a
            className="underline hover:opacity-75"
            href="https://sistemaswebb3-derivativos.b3.com.br/referenceRatesPage/all?language=pt-br"
            target="_blank"
            rel="noreferrer"
          >
            página oficial
          </a>
          ). Dados capturados automaticamente uma vez por dia útil; uso informativo, sem garantias.
        </p>
        <p className="mt-1">
          A Dexterity não se responsabiliza pelos dados exibidos nem por decisões tomadas a partir
          deles — favor consultar sempre os dados oficiais na B3.
        </p>
      </footer>
    </main>
  )
}
