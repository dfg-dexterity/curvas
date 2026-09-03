'use client'

import { useMemo, useState } from 'react'
import { fmtValueFull, isRateKind, valueKindFor, valueUnitLabel, type ValueKind } from '../lib/curves/value-kind'
import { fmtDateBr } from '../lib/format'
import type { CurvePointJSON } from '../lib/ingest'

/** Nome da coluna de valor no CSV/tabela conforme a classe da curva. */
function valueColumnLabel(kind: ValueKind): string {
  switch (kind) {
    case 'rate252':
      return '252 (% a.a.)'
    case 'rate360':
      return '360 (% a.a.)'
    case 'price':
      return 'Preço'
    case 'index':
      return 'Pontos'
    case 'spread':
      return 'Spread'
  }
}

function buildCsv(points: CurvePointJSON[], kind: ValueKind, has252: boolean, has360: boolean): string {
  const rateCurve = isRateKind(kind)
  const header = rateCurve
    ? ['dias_corridos', has252 ? 'taxa_252' : null, has360 ? 'taxa_360' : null].filter(Boolean).join(';')
    : ['dias_corridos', kind === 'price' ? 'preco' : kind === 'index' ? 'pontos' : 'spread'].join(';')
  const lines = points.map((p) => {
    const cols: Array<string | number> = [p.days]
    if (rateCurve) {
      if (has252) cols.push(p.rate252 ?? '')
      if (has360) cols.push(p.rate360 ?? '')
    } else {
      cols.push(p.rate252 ?? p.rate360 ?? '')
    }
    return cols.map((v) => String(v).replace('.', ',')).join(';')
  })
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
  const kind = valueKindFor(rateCode)
  const rateCurve = isRateKind(kind)

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return points
    return points.filter((p) => String(p.days).startsWith(q))
  }, [points, query])

  function downloadCsv() {
    const csv = buildCsv(points, kind, has252, has360)
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
            {points.length.toLocaleString('pt-BR')} prazos em {valueUnitLabel(kind)}, valores originais da B3 (sem interpolação)
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
          <a
            href={`/api/export/sap?rates=${encodeURIComponent(rateCode)}&date=${encodeURIComponent(date)}`}
            className="control cursor-pointer font-medium hover:opacity-80"
            title="Arquivo de carga SAP: um registro por vértice, código com o dia (ex.: DIPRE001)"
          >
            Exportar SAP
          </a>
        </div>
      </header>

      <div className="max-h-96 overflow-auto px-5 pb-4">
        <table className="w-full text-sm tabular-nums">
          <thead className="sticky top-0" style={{ background: 'var(--surface)' }}>
            <tr className="text-left text-xs" style={{ color: 'var(--muted)' }}>
              <th className="py-2 pr-4 font-medium">Dias corridos</th>
              {rateCurve ? (
                <>
                  {has252 && <th className="py-2 pr-4 font-medium">252 (% a.a.)</th>}
                  {has360 && <th className="py-2 font-medium">360 (% a.a.)</th>}
                </>
              ) : (
                <th className="py-2 font-medium">{valueColumnLabel(kind)}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.days} className="border-t" style={{ borderColor: 'var(--grid)' }}>
                <td className="py-1.5 pr-4">{p.days.toLocaleString('pt-BR')}</td>
                {rateCurve ? (
                  <>
                    {has252 && <td className="py-1.5 pr-4">{fmtValueFull(kind, p.rate252)}</td>}
                    {has360 && <td className="py-1.5">{fmtValueFull(kind, p.rate360)}</td>}
                  </>
                ) : (
                  <td className="py-1.5">{fmtValueFull(kind, p.rate252 ?? p.rate360)}</td>
                )}
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
