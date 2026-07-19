'use client'

import { useEffect, useState } from 'react'
import { fmtDateBr, fmtPct } from '../lib/format'

const METHOD_LABELS: Record<string, string> = {
  exp252: 'Exponencial 252 (Manual 1.4.1)',
  ff252: 'Flat Forward 252 (Manual 1.4.2)',
  ffLinear360: 'Flat Forward 252, convenção linear (Manual 1.4.3)',
  exp360: 'Interpolação 360 (Manual 1.4.4)',
  price: 'Interpolação de preços (Manual 1.4.5)',
  linear360: 'Interpolação 360 linear (Manual 1.4.11)',
}

interface InterpolateResponse {
  rate: { code: string; name: string }
  baseDate: string
  targetDate: string
  dc: number
  du: number
  basis: '252' | '360'
  method: string
  knownConfig: boolean
  extrapolated: boolean
  lastVertexDc: number
  value: number
  error?: string
  message?: string
}

interface Props {
  rateCode: string
  /** Data da curva primária selecionada no dashboard (ISO). */
  date: string | undefined
}

/**
 * "Data customizada": o usuário informa uma data-alvo (ex.: um vencimento) e o
 * painel mostra a taxa interpolada naquele prazo pela regra do Manual de
 * Curvas da B3, junto com a contagem de dias corridos/úteis usada.
 */
export function InterpolatePanel({ rateCode, date }: Props) {
  const [target, setTarget] = useState('')
  const [result, setResult] = useState<{ key: string; data?: InterpolateResponse; error?: string } | null>(null)

  const valid = Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(target) && target > (date ?? ''))
  const key = valid ? `${rateCode}|${date}|${target}` : ''

  useEffect(() => {
    if (!key || !date) return
    let cancelled = false
    const params = new URLSearchParams({ rate: rateCode, date, target })
    fetch(`/api/curves/interpolate?${params.toString()}`)
      .then(async (res) => {
        const body = (await res.json()) as InterpolateResponse
        if (!res.ok) throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`)
        return body
      })
      .then((body) => !cancelled && setResult({ key, data: body }))
      .catch(
        (err) =>
          !cancelled && setResult({ key, error: err instanceof Error ? err.message : String(err) }),
      )
    return () => {
      cancelled = true
    }
  }, [key, rateCode, date, target])

  const loading = Boolean(key) && result?.key !== key
  const data = result?.key === key ? result.data : undefined
  const error = result?.key === key ? result.error : undefined

  return (
    <section className="card mb-4 px-4 py-4" aria-label="Interpolação em data customizada">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div>
          <h2 className="text-sm font-semibold">Taxa em data customizada</h2>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Informe um vencimento e a curva é interpolada pela regra do Manual de Curvas da B3.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--ink-2)' }}>
          data-alvo
          <input
            type="date"
            value={target}
            min={date ? `${date.slice(0, 10)}` : undefined}
            onChange={(e) => setTarget(e.target.value)}
            className="chip cursor-pointer px-2 py-1"
          />
        </label>
      </header>

      {!target && (
        <p className="px-1 text-xs" style={{ color: 'var(--muted)' }}>
          Escolha uma data posterior a {date ? fmtDateBr(date) : 'à data da curva'} — pode ser além do
          último vértice (extrapolação do último segmento).
        </p>
      )}
      {target && !valid && (
        <p className="px-1 text-xs" style={{ color: 'var(--muted)' }}>
          A data-alvo precisa ser posterior à data da curva ({date ? fmtDateBr(date) : '—'}).
        </p>
      )}
      {loading && (
        <p className="px-1 text-xs" style={{ color: 'var(--muted)' }}>
          calculando…
        </p>
      )}
      {error && (
        <p className="px-1 text-xs" role="alert" style={{ color: 'var(--danger, #b91c1c)' }}>
          ⚠ {error}
        </p>
      )}

      {data && !loading && (
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-1">
          <p className="text-2xl font-semibold">{fmtPct(data.value)}</p>
          <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
            {data.rate.code} em {fmtDateBr(data.targetDate)} · base {data.basis === '252' ? '252 dias úteis' : '360 dias corridos'}
          </p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {data.dc} dias corridos · {data.du} dias úteis (ANBIMA) ·{' '}
            {METHOD_LABELS[data.method] ?? data.method}
            {data.extrapolated && ' · extrapolado além do último vértice'}
            {!data.knownConfig && ' · curva sem regra específica no manual (usado Flat Forward 252)'}
          </p>
        </div>
      )}
    </section>
  )
}
