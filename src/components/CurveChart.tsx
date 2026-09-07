'use client'

import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { buildSharedGrid, resampleCurve, type RateBase } from '../lib/curve-math'
import { fmtValue, isRateKind, type ValueKind } from '../lib/curves/value-kind'
import { fmtDateShortBr, fmtDaysLabel } from '../lib/format'
import type { CurvePointJSON } from '../lib/ingest'
import type { VizTheme } from './theme'

export interface CurveSeries {
  date: string
  slot: number
  points: CurvePointJSON[]
}

const CHART_HEIGHT = 440
const MARGIN = { top: 12, right: 76, bottom: 4, left: 8 }
const X_AXIS_HEIGHT = 28
const PLOT_TOP = MARGIN.top
const PLOT_BOTTOM = MARGIN.bottom + X_AXIS_HEIGHT

const TERM_TICKS = [30, 91, 182, 365, 730, 1095, 1460, 1825, 2555, 3650, 4380, 5475, 7300, 9125, 10950]

/** Formata o eixo Y conforme a classe de valor da curva. */
function makeTickFormatter(kind: ValueKind): (value: number) => string {
  if (kind === 'index') return (v) => Math.round(v).toLocaleString('pt-BR')
  if (kind === 'price') return (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 4 })
  return (v) => v.toFixed(2).replace('.', ',')
}

interface TooltipEntry {
  dataKey?: string | number
  value?: number | string | null
  color?: string
}

function CurveTooltip({
  active,
  payload,
  label,
  kind,
}: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: number | string
  kind: ValueKind
}) {
  if (!active || !payload?.length) return null
  const rows = payload
    .filter((entry) => typeof entry.value === 'number')
    .sort((a, b) => (b.value as number) - (a.value as number))
  if (rows.length === 0) return null
  const days = Number(label)

  return (
    <div className="card px-3 py-2 text-xs shadow-lg" style={{ background: 'var(--surface)' }}>
      <p className="mb-1 font-medium" style={{ color: 'var(--ink-2)' }}>
        {days} dias corridos {days >= 60 ? `(≈ ${fmtDaysLabel(days)})` : ''}
      </p>
      <ul className="space-y-0.5">
        {rows.map((entry) => (
          <li key={String(entry.dataKey)} className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-0.5 w-3" style={{ background: entry.color }} />
            <span className="font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
              {fmtValue(kind, entry.value as number)}
            </span>
            <span style={{ color: 'var(--ink-2)' }}>{fmtDateShortBr(String(entry.dataKey))}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Sobreposição de curvas (prazo × taxa) de até 6 datas da mesma taxa.
 * As curvas são reamostradas numa grade comum de prazos para o crosshair
 * mostrar todas as séries em qualquer X; a tabela abaixo do gráfico mantém
 * os vértices originais publicados pela B3.
 */
export function CurveChart({
  series,
  base,
  theme,
  valueKind = 'rate252',
  loading = false,
}: {
  series: CurveSeries[]
  base: RateBase
  theme: VizTheme
  valueKind?: ValueKind
  loading?: boolean
}) {
  const { data, domain, endLabels, xMin, xMax } = useMemo(() => {
    const withPoints = series.filter((s) => s.points.length > 0)
    const grid = buildSharedGrid(withPoints.map((s) => s.points))
    const sampled = withPoints.map((s) => ({
      key: s.date,
      slot: s.slot,
      values: resampleCurve(s.points, grid, base),
    }))

    const rows = grid.map((days, i) => {
      const row: Record<string, number | null> = { days }
      for (const s of sampled) row[s.key] = s.values[i]
      return row
    })

    let min = Infinity
    let max = -Infinity
    for (const s of sampled) {
      for (const v of s.values) {
        if (v === null) continue
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    if (!Number.isFinite(min) || grid.length === 0) {
      return { data: [], domain: [0, 1] as [number, number], endLabels: [], xMin: 0, xMax: 0 }
    }
    const pad = Math.max((max - min) * 0.06, isRateKind(valueKind) ? 0.05 : Math.abs(max) * 0.001)
    const lo = min - pad
    const hi = max + pad

    // Rótulos diretos na ponta de cada linha (canal de identidade além da cor).
    const plotHeight = CHART_HEIGHT - PLOT_TOP - PLOT_BOTTOM
    const raw = sampled
      .map((s) => {
        const lastIdx = s.values.reduce<number>((acc, v, i) => (v !== null ? i : acc), -1)
        if (lastIdx < 0) return null
        return { key: s.key, slot: s.slot, value: s.values[lastIdx] as number }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .map((s) => ({
        ...s,
        y: PLOT_TOP + ((hi - s.value) / (hi - lo)) * plotHeight,
      }))
      .sort((a, b) => a.y - b.y)

    // Anticolisão: empurra rótulos para baixo mantendo 16px de distância.
    for (let i = 1; i < raw.length; i++) {
      if (raw[i].y - raw[i - 1].y < 16) raw[i].y = raw[i - 1].y + 16
    }

    return {
      data: rows,
      domain: [lo, hi] as [number, number],
      endLabels: raw,
      xMin: grid[0],
      xMax: grid[grid.length - 1],
    }
  }, [series, base, valueKind])

  const visible = series.filter((s) => s.points.length > 0)

  if (visible.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm"
        style={{ height: CHART_HEIGHT, color: 'var(--muted)' }}
      >
        Sem dados para exibir — escolha outra data ou taxa.
      </div>
    )
  }

  const ticks = TERM_TICKS.filter((t) => t >= xMin && t <= xMax)

  return (
    <div
      className="relative transition-opacity"
      style={{ height: CHART_HEIGHT, opacity: loading ? 0.45 : 1 }}
      aria-busy={loading}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={MARGIN}>
          <CartesianGrid vertical={false} stroke={theme.grid} strokeWidth={1} />
          <XAxis
            dataKey="days"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={ticks}
            tickFormatter={fmtDaysLabel}
            tickLine={false}
            axisLine={{ stroke: theme.axis }}
            tick={{ fill: theme.muted, fontSize: 11 }}
            height={X_AXIS_HEIGHT}
          />
          <YAxis
            domain={domain}
            tickFormatter={makeTickFormatter(valueKind)}
            tickLine={false}
            axisLine={false}
            tick={{ fill: theme.muted, fontSize: 11, fontVariant: 'tabular-nums' }}
            width={valueKind === 'index' ? 66 : 52}
          />
          <Tooltip
            content={<CurveTooltip kind={valueKind} />}
            cursor={{ stroke: theme.axis, strokeWidth: 1 }}
            isAnimationActive={false}
          />
          {visible.map((s) => (
            <Line
              key={s.date}
              dataKey={s.date}
              type="monotone"
              stroke={theme.series[s.slot % theme.series.length]}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: theme.surface }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      {/* Rótulos diretos nas pontas (texto em tinta, cor só na chave de linha) */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0" style={{ width: MARGIN.right - 4 }}>
        {endLabels.map((labelInfo) => (
          <div
            key={labelInfo.key}
            className="absolute flex -translate-y-1/2 items-center gap-1 text-[10px]"
            style={{ top: labelInfo.y, left: 2, color: 'var(--ink-2)' }}
          >
            <span
              aria-hidden
              className="inline-block h-0.5 w-2.5"
              style={{ background: theme.series[labelInfo.slot % theme.series.length] }}
            />
            {fmtDateShortBr(labelInfo.key)}
          </div>
        ))}
      </div>
    </div>
  )
}
