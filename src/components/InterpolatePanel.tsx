'use client'

import { useEffect, useState } from 'react'
import { fmtValue, isRateKind, valueChipLabel, valueKindFor } from '../lib/curves/value-kind'
import { fmtDateBr } from '../lib/format'

export const METHOD_LABELS: Record<string, string> = {
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
  explanation?: {
    mode: string
    steps: string[]
  }
  error?: string
  message?: string
}

interface Props {
  rateCode: string
  /** Data da curva primária selecionada no dashboard (ISO). */
  date: string | undefined
}

/**
 * Consulta principal do dia a dia: o usuário informa uma data-alvo (ex.: um
 * vencimento) e recebe a taxa interpolada naquele prazo pela regra do Manual
 * de Curvas da B3, com a contagem DC/DU usada e a memória de cálculo.
 */
export function InterpolatePanel({ rateCode, date }: Props) {
  const kind = valueKindFor(rateCode)
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
    <section
      className="card mb-4 px-5 py-4"
      style={{ borderColor: 'var(--accent)' }}
      aria-label="Taxa em data customizada"
    >
      <div className="grid gap-x-8 gap-y-3 md:grid-cols-[minmax(15rem,18rem)_1fr]">
        {/* Entrada */}
        <div>
          <h2 className="text-sm font-semibold">Taxa em data customizada</h2>
          <p className="mb-3 mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
            Informe um vencimento e {isRateKind(kind) ? 'a taxa' : kind === 'price' ? 'o preço' : 'o valor'}{' '}
            da curva {rateCode} é interpolado pela regra do Manual de Curvas da B3 — inclusive além
            do último vértice.
          </p>
          <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
            Data-alvo
            <input
              type="date"
              value={target}
              min={date ?? undefined}
              onChange={(e) => setTarget(e.target.value)}
              className="control mt-1 block w-full cursor-pointer px-3 py-2 text-sm"
            />
          </label>
          <p className="mt-2 text-[11px] leading-snug" style={{ color: 'var(--muted)' }}>
            Curva-base: {date ? fmtDateBr(date) : '—'}. Uso informativo — confira os dados oficiais
            na B3 antes de decisões.
          </p>
        </div>

        {/* Resultado */}
        <div className="flex flex-col justify-center">
          {!target && (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Escolha uma data posterior a {date ? fmtDateBr(date) : 'à data da curva'} para ver a
              taxa interpolada, a contagem de dias e a memória de cálculo.
            </p>
          )}
          {target && !valid && (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              A data-alvo precisa ser posterior à data da curva ({date ? fmtDateBr(date) : '—'}).
            </p>
          )}
          {loading && (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              calculando…
            </p>
          )}
          {error && (
            <p className="text-sm" role="alert" style={{ color: 'var(--danger, #b91c1c)' }}>
              ⚠ {error}
            </p>
          )}
          {data && !loading && (
            <>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <p className="text-3xl font-semibold tracking-tight tabular-nums">
                  {fmtValue(kind, data.value)}
                </p>
                <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
                  {data.rate.code} em {fmtDateBr(data.targetDate)}
                </p>
                <span className="chip text-[11px]" style={{ color: 'var(--ink-2)' }}>
                  {valueChipLabel(kind)}
                </span>
                {data.extrapolated && (
                  <span className="chip text-[11px]" style={{ color: 'var(--ink-2)' }}>
                    extrapolada
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                {data.dc} dias corridos · {data.du} dias úteis (ANBIMA) ·{' '}
                {METHOD_LABELS[data.method] ?? data.method}
                {!data.knownConfig && ' · curva sem regra específica no manual (usado Flat Forward 252)'}
              </p>
              {data.explanation && data.explanation.steps.length > 0 && (
                <details className="mt-2">
                  <summary
                    className="cursor-pointer text-xs font-medium"
                    style={{ color: 'var(--ink-2)' }}
                  >
                    Como foi calculado
                  </summary>
                  <ol
                    className="mt-1.5 list-decimal space-y-1 pl-5 text-xs"
                    style={{ color: 'var(--ink-2)' }}
                  >
                    {data.explanation.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
