'use client'

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fmtDateBr, fmtDateShortBr } from '../lib/format'
import type { VizTheme } from './theme'

export interface HistoryPoint {
  date: string
  value: number
}

function fmtTick(value: number): string {
  return value.toFixed(2).replace('.', ',')
}

function HistoryTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value?: number | string | null }>
  label?: string
}) {
  const value = payload?.[0]?.value
  if (!active || typeof value !== 'number') return null
  return (
    <div className="card px-3 py-2 text-xs shadow-lg" style={{ background: 'var(--surface)' }}>
      <span className="font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
        {fmtTick(value)}%
      </span>{' '}
      <span style={{ color: 'var(--ink-2)' }}>em {fmtDateBr(String(label))}</span>
    </div>
  )
}

/** Série temporal de um prazo fixo da curva (uma série — sem caixa de legenda). */
export function HistoryChart({
  points,
  theme,
  loading = false,
}: {
  points: HistoryPoint[]
  theme: VizTheme
  loading?: boolean
}) {
  if (points.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center px-6 text-center text-sm" style={{ color: 'var(--muted)' }}>
        Ainda não há histórico suficiente no banco para este prazo — rode o backfill para preencher datas passadas.
      </div>
    )
  }

  let min = Infinity
  let max = -Infinity
  for (const p of points) {
    if (p.value < min) min = p.value
    if (p.value > max) max = p.value
  }
  const pad = Math.max((max - min) * 0.08, 0.05)

  return (
    <div className="transition-opacity" style={{ height: 224, opacity: loading ? 0.45 : 1 }} aria-busy={loading}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid vertical={false} stroke={theme.grid} strokeWidth={1} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDateShortBr}
            tickLine={false}
            axisLine={{ stroke: theme.axis }}
            tick={{ fill: theme.muted, fontSize: 11 }}
            minTickGap={48}
            height={26}
          />
          <YAxis
            domain={[min - pad, max + pad]}
            tickFormatter={fmtTick}
            tickLine={false}
            axisLine={false}
            tick={{ fill: theme.muted, fontSize: 11, fontVariant: 'tabular-nums' }}
            width={52}
          />
          <Tooltip
            content={<HistoryTooltip />}
            cursor={{ stroke: theme.axis, strokeWidth: 1 }}
            isAnimationActive={false}
          />
          <Line
            dataKey="value"
            type="monotone"
            stroke={theme.series[0]}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: theme.surface }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
