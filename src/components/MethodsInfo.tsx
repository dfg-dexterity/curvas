'use client'

import { CURVE_CONFIGS, type CurveConfig } from '../lib/curves/interpolation'
import { METHOD_LABELS } from './InterpolatePanel'

function extrapolationLabel(config: CurveConfig): string {
  return config.extrapolateEnd === 'flat'
    ? 'Repete o último vértice (1.4.8)'
    : config.method === 'ffLinear360'
      ? 'Prolonga o último segmento (1.4.10)'
      : 'Prolonga o último segmento (1.4.6)'
}

function roundingLabel(config: CurveConfig): string {
  if (!config.rounding) return '—'
  const action = config.rounding.mode === 'round' ? 'Arredonda' : 'Trunca'
  return `${action} na ${config.rounding.decimals}ª casa`
}

interface Props {
  /** Nomes das taxas (código → nome) vindos de /api/rates, quando carregados. */
  rateNames: Record<string, string>
}

/**
 * Referência estática, gerada da própria configuração usada pelo cálculo
 * (CURVE_CONFIGS): como cada curva é interpolada segundo o Manual de Curvas
 * da B3. Fica no fim da página como material de consulta.
 */
export function MethodsInfo({ rateNames }: Props) {
  const rows = Object.entries(CURVE_CONFIGS)

  return (
    <section className="card mt-4 px-5 py-4" aria-label="Como cada curva é interpolada">
      <h2 className="text-sm font-semibold">Como cada curva é interpolada</h2>
      <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
        Regras do <strong>Manual de Curvas da B3</strong> (versão 12/12/2025), aplicadas pela
        consulta de data customizada. A ideia central do Flat Forward: em vez de traçar uma reta
        entre duas taxas, interpola-se o <em>fator de capitalização</em> — assumindo que o juro a
        termo (forward) embutido entre dois vértices vizinhos é constante. Nas curvas base 252 o
        peso usa dias úteis (calendário ANBIMA); nas cambiais, os fatores são lineares
        (i·DC/36000); nas curvas de preço, a interpolação é geométrica sobre o preço.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[38rem] text-left text-xs">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--hairline)', color: 'var(--muted)' }}>
              <th className="py-1.5 pr-4 font-medium">Curva</th>
              <th className="py-1.5 pr-4 font-medium">Interpolação</th>
              <th className="py-1.5 pr-4 font-medium">Além do último vértice</th>
              <th className="py-1.5 font-medium">Valor final</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([code, config]) => (
              <tr key={code} className="border-b" style={{ borderColor: 'var(--hairline)' }}>
                <td className="py-1.5 pr-4 font-medium whitespace-nowrap">
                  {code}
                  {rateNames[code] && (
                    <span className="ml-1.5 font-normal" style={{ color: 'var(--muted)' }}>
                      {rateNames[code]}
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-4">{METHOD_LABELS[config.method] ?? config.method}</td>
                <td className="py-1.5 pr-4">{extrapolationLabel(config)}</td>
                <td className="py-1.5">{roundingLabel(config)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-1.5 pr-4 font-medium whitespace-nowrap">Demais códigos</td>
              <td className="py-1.5 pr-4">{METHOD_LABELS.ff252}</td>
              <td className="py-1.5 pr-4">Prolonga o último segmento (1.4.6)</td>
              <td className="py-1.5">—</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
        Para DIC/DIM o manual referencia a fórmula &quot;Interpolation252Year&quot; sem definição
        fechada; adotou-se o Flat Forward 252, padrão da base 252 no próprio manual. Dias úteis
        contados no calendário de feriados nacionais (ANBIMA), incluindo feriados móveis.
      </p>
    </section>
  )
}
