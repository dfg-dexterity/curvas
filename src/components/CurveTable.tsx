'use client'

import { useMemo, useState } from 'react'
import { fmtDateBr, fmtRate } from '../lib/format'
import type { CurvePointJSON } from '../lib/ingest'

function buildCsv(points: CurvePointJSON[], has252: boolean, has360: boolean): string {
  const header = ['dias_corridos', has252 ? 'taxa_252' : null, has360 ? 'taxa_360' : null]
    .filter(Boolean)
    .join(';')
  const lines = points.map((p) =>
    [
      p.days,
      has252 ? (p.rate252 ?? '') : null,
      has360 ? (p.rate360 ?? '') : null,
    ]
      .filter((v) => v !== null)
      .map((v) => String(v).replace('.', ','))
      .join(';'),
  )
  return [header, ...lines].join('\n')
}

/** Vértices originais publicados pela B3 para a data principal (visão-tabela). */
export function CurveTable({
  rateCode,
  date,
  points,
  has252,
  has360,
}: {
  rateCode: string
  date: string
  points: CurvePointJSON[]
  has252: boolean
  has360: boolean
}) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return points
    return points.filter((p) => String(p.days).startsWith(q))
  }, [points, query])

  function downloadCsv() {
    const csv = buildCsv(points, has252, has360)
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `curva_${rateCode}_${date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (points.length === 0) return null

  return (
    <section className="card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3" style={{ borderColor: 'var(--hairline)' }}>
        <div>
          <h2 className="text-sm font-semibold">Vértices publicados — {rateCode} em {fmtDateBr(date)}</h2>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {points.length.toLocaleString('pt-BR')} prazos, valores originais da B3 (sem interpolação)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrar prazo…"
            aria-label="Filtrar por prazo em dias corridos"
            className="control w-36"
          />
          <button type="button" onClick={downloadCsv} className="control cursor-pointer font-medium hover:opacity-80">
            Baixar CSV
          </button>
        </div>
      </header>

      <div className="max-h-96 overflow-auto px-5 pb-4">
        <table className="w-full text-sm tabular-nums">
          <thead className="sticky top-0" style={{ background: 'var(--surface)' }}>
            <tr className="text-left text-xs" style={{ color: 'var(--muted)' }}>
              <th className="py-2 pr-4 font-medium">Dias corridos</th>
              {has252 && <th className="py-2 pr-4 font-medium">252 (% a.a.)</th>}
              {has360 && <th className="py-2 font-medium">360 (% a.a.)</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.days} className="border-t" style={{ borderColor: 'var(--grid)' }}>
                <td className="py-1.5 pr-4">{p.days.toLocaleString('pt-BR')}</td>
                {has252 && <td className="py-1.5 pr-4">{fmtRate(p.rate252)}</td>}
                {has360 && <td className="py-1.5">{fmtRate(p.rate360)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="py-6 text-center text-sm" style={{ color: 'var(--muted)' }}>
            Nenhum prazo começa com “{query}”.
          </p>
        )}
      </div>
    </section>
  )
}
