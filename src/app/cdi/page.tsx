'use client'

import { useMemo, useState } from 'react'
import {
  corrigirPorCDI,
  corrigirPorTaxaFixaMensal,
  type BaseSpread,
  type PontoCDI,
  type ResultadoCorrecaoCDI,
} from '../../lib/financas/cdi'
import { calcularImpostosRendaFixa, type ResultadoImpostos } from '../../lib/financas/impostos'
import { calendarDaysBetween } from '../../lib/curves/calendar'
import { fmtDateBr } from '../../lib/format'
import { todayInSaoPaulo } from '../../lib/dates'

const nfBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nf4 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

const inputCls = 'control mt-1 block w-full px-3 py-2 text-sm'

interface ResultadoCompleto {
  tipo: 'cdi' | 'fixa'
  correcao: ResultadoCorrecaoCDI | null
  memoriaFixa: Array<{ mes: number; taxa: number; fator: number; valorCorrigido: number }> | null
  valorInicial: number
  valorFinalBruto: number
  impostos: ResultadoImpostos
  dataInicial: string
  dataFinal: string
}

export default function PaginaCDI() {
  const [valorInicial, setValorInicial] = useState('100000')
  const [dataInicial, setDataInicial] = useState('')
  const [dataFinal, setDataFinal] = useState(todayInSaoPaulo())
  const [tipoTaxa, setTipoTaxa] = useState<'cdi' | 'fixa'>('cdi')
  const [percentualCDI, setPercentualCDI] = useState('100')
  const [spread, setSpread] = useState('')
  const [baseSpread, setBaseSpread] = useState<BaseSpread>('DU/252')
  const [taxaFixaMensal, setTaxaFixaMensal] = useState('')
  const [indexador, setIndexador] = useState<'cdi' | 'selic'>('cdi')
  const [mostrarLiquido, setMostrarLiquido] = useState(true)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<ResultadoCompleto | null>(null)

  const calcular = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    const valor = Number(valorInicial)
    if (!Number.isFinite(valor) || valor <= 0) return setErro('Informe um valor inicial válido.')
    if (!dataInicial || !dataFinal || dataFinal <= dataInicial) {
      return setErro('Informe datas válidas (final posterior à inicial).')
    }

    setCarregando(true)
    try {
      if (tipoTaxa === 'fixa') {
        const taxa = Number(taxaFixaMensal)
        if (!Number.isFinite(taxa) || taxa <= 0) throw new Error('Informe a taxa mensal.')
        const { valorFinal, memoria } = corrigirPorTaxaFixaMensal(valor, taxa, dataInicial, dataFinal)
        const dc = calendarDaysBetween(dataInicial, dataFinal)
        setResultado({
          tipo: 'fixa',
          correcao: null,
          memoriaFixa: memoria,
          valorInicial: valor,
          valorFinalBruto: valorFinal,
          impostos: calcularImpostosRendaFixa(valor, valorFinal, dc),
          dataInicial,
          dataFinal,
        })
      } else {
        const res = await fetch(`/api/bcb/cdi?from=${dataInicial}&to=${dataFinal}&serie=${indexador}`)
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
        // Convenção do fator DI: a taxa do dia remunera até o dia seguinte —
        // entram os dias úteis em [dataInicial, dataFinal).
        const serie = (body.serie as PontoCDI[]).filter((p) => p.date < dataFinal)
        if (serie.length === 0) throw new Error('Sem dados do indexador no período no BCB.')
        const correcao = corrigirPorCDI(valor, serie, {
          percentualCDI: Number(percentualCDI) || 100,
          spreadAA: Number(spread) || 0,
          baseSpread,
          dataInicial,
          dataFinal,
        })
        setResultado({
          tipo: 'cdi',
          correcao,
          memoriaFixa: null,
          valorInicial: valor,
          valorFinalBruto: correcao.valorFinal,
          impostos: calcularImpostosRendaFixa(valor, correcao.valorFinal, correcao.diasCorridos),
          dataInicial,
          dataFinal,
        })
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err))
    } finally {
      setCarregando(false)
    }
  }

  const memoriaVisivel = useMemo(() => resultado?.correcao?.memoria.slice(-90) ?? [], [resultado])

  const baixarCSV = () => {
    if (!resultado?.correcao) return
    const linhas = [
      'data;taxa_cdi_aa;taxa_diaria;fator_diario;fator_acumulado;valor_corrigido',
      ...resultado.correcao.memoria.map(
        (m) =>
          `${m.date};${m.taxaCDI};${m.taxaDiaria.toFixed(8)};${m.fatorDiario.toFixed(10)};${m.fatorAcumulado.toFixed(10)};${m.valorCorrigido.toFixed(2)}`,
      ),
    ]
    const blob = new Blob([linhas.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `correcao-cdi-${resultado.dataInicial}-a-${resultado.dataFinal}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const imp = resultado?.impostos

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Correção pelo CDI</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Contratos e aplicações remunerados por CDI (ou Selic) com dados diários oficiais do BCB —
          percentual do CDI, spread, IRRF e IOF regressivos, memória de cálculo e taxa prefixada
          mensal alternativa.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(19rem,23rem)_1fr]">
        <form onSubmit={calcular} className="card h-fit space-y-3 px-5 py-4">
          <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
            Valor inicial (R$)
            <input type="number" step="any" min="0" value={valorInicial} onChange={(e) => setValorInicial(e.target.value)} className={inputCls} required />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
              Data inicial
              <input type="date" value={dataInicial} onChange={(e) => setDataInicial(e.target.value)} className={inputCls} required />
            </label>
            <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
              Data final
              <input type="date" value={dataFinal} min={dataInicial} onChange={(e) => setDataFinal(e.target.value)} className={inputCls} required />
            </label>
          </div>

          <div role="group" aria-label="Tipo de taxa" className="control flex gap-0 p-0.5">
            {(
              [
                ['cdi', 'CDI / Selic (dados reais)'],
                ['fixa', 'Taxa fixa mensal'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTipoTaxa(id)}
                className="flex-1 cursor-pointer rounded-md px-2 py-1 text-xs font-medium"
                style={tipoTaxa === id ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--ink-2)' }}
              >
                {label}
              </button>
            ))}
          </div>

          {tipoTaxa === 'cdi' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
                  Indexador
                  <select value={indexador} onChange={(e) => setIndexador(e.target.value as 'cdi' | 'selic')} className={inputCls}>
                    <option value="cdi">CDI (SGS 4389)</option>
                    <option value="selic">Selic (SGS 1178)</option>
                  </select>
                </label>
                <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
                  % do indexador
                  <input type="number" step="any" min="1" value={percentualCDI} onChange={(e) => setPercentualCDI(e.target.value)} className={inputCls} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
                  Spread (% a.a., opcional)
                  <input type="number" step="any" min="0" value={spread} onChange={(e) => setSpread(e.target.value)} className={inputCls} />
                </label>
                <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
                  Base do spread
                  <select value={baseSpread} onChange={(e) => setBaseSpread(e.target.value as BaseSpread)} className={inputCls}>
                    <option value="DU/252">DU/252 (exponencial)</option>
                    <option value="DC/360">DC/360 (linear)</option>
                    <option value="DC/365">DC/365 (linear)</option>
                    <option value="sobre-di">Sobre o valor corrigido</option>
                  </select>
                </label>
              </div>
            </>
          ) : (
            <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
              Taxa fixa (% ao mês)
              <input type="number" step="any" min="0" value={taxaFixaMensal} onChange={(e) => setTaxaFixaMensal(e.target.value)} className={inputCls} />
            </label>
          )}

          <label className="flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
            <input type="checkbox" checked={mostrarLiquido} onChange={(e) => setMostrarLiquido(e.target.checked)} />
            Calcular IRRF e IOF (aplicações de renda fixa)
          </label>

          <button
            type="submit"
            disabled={carregando}
            className="w-full cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >
            {carregando ? 'Calculando…' : 'Calcular correção'}
          </button>
          {erro && (
            <p className="text-xs" role="alert" style={{ color: 'var(--danger, #b91c1c)' }}>
              ⚠ {erro}
            </p>
          )}
        </form>

        <div className="space-y-4">
          {!resultado && (
            <div className="card px-5 py-4 text-sm" style={{ color: 'var(--muted)' }}>
              Fator diário (1 + CDI·p/100)^(1/252) acumulado dia a dia com a série oficial do BCB, o
              percentual aplicado sobre a taxa anual; spread nas bases DU/252, DC/360, DC/365 ou
              sobre o valor corrigido. IRRF pela tabela regressiva (22,5% → 15%) e IOF regressivo
              até o 30º dia, como na legislação vigente.
            </div>
          )}

          {resultado && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="card px-4 py-3">
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>Valor corrigido (bruto)</p>
                  <p className="text-lg font-semibold tabular-nums">{nfBRL.format(resultado.valorFinalBruto)}</p>
                </div>
                <div className="card px-4 py-3">
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>Rendimento bruto</p>
                  <p className="text-lg font-semibold tabular-nums" style={{ color: 'var(--accent)' }}>
                    {nfBRL.format(resultado.valorFinalBruto - resultado.valorInicial)}
                  </p>
                </div>
                {resultado.correcao && (
                  <div className="card px-4 py-3">
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>Fator acumulado</p>
                    <p className="text-lg font-semibold tabular-nums">{resultado.correcao.fatorCDI.toFixed(8)}</p>
                  </div>
                )}
                {resultado.correcao && (
                  <div className="card px-4 py-3">
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>Taxa média do período</p>
                    <p className="text-lg font-semibold tabular-nums">{nf2.format(resultado.correcao.taxaMediaCDI)}% a.a.</p>
                  </div>
                )}
              </div>

              {resultado.correcao && (
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  {fmtDateBr(resultado.dataInicial)} → {fmtDateBr(resultado.dataFinal)} ·{' '}
                  {resultado.correcao.diasUteis} dias úteis · {resultado.correcao.diasCorridos} dias
                  corridos
                  {resultado.correcao.jurosSpread > 0 &&
                    ` · juros do spread: ${nfBRL.format(resultado.correcao.jurosSpread)}`}
                </p>
              )}

              {mostrarLiquido && imp && (
                <section className="card px-5 py-4" aria-label="Impostos">
                  <h2 className="text-sm font-semibold">IRRF e IOF (tabelas regressivas)</h2>
                  <dl className="mt-2 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
                    <div className="flex justify-between gap-4">
                      <dt style={{ color: 'var(--muted)' }}>IOF ({nf2.format(imp.aliquotaIOF)}% do rendimento)</dt>
                      <dd className="tabular-nums">{nfBRL.format(imp.valorIOF)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt style={{ color: 'var(--muted)' }}>IRRF ({nf2.format(imp.aliquotaIRRF)}%)</dt>
                      <dd className="tabular-nums">{nfBRL.format(imp.valorIRRF)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt style={{ color: 'var(--muted)' }}>Total de impostos</dt>
                      <dd className="tabular-nums">{nfBRL.format(imp.totalImpostos)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="font-medium">Valor final líquido</dt>
                      <dd className="tabular-nums font-semibold" style={{ color: 'var(--accent)' }}>
                        {nfBRL.format(imp.valorFinalLiquido)}
                      </dd>
                    </div>
                  </dl>
                </section>
              )}

              {resultado.correcao && (
                <section className="card px-5 py-4" aria-label="Memória de cálculo">
                  <header className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">
                      Memória de cálculo diária ({resultado.correcao.memoria.length} dias úteis)
                    </h2>
                    <button type="button" onClick={baixarCSV} className="chip cursor-pointer hover:opacity-75" style={{ color: 'var(--ink-2)' }}>
                      Baixar CSV completo
                    </button>
                  </header>
                  <div className="mt-2 max-h-96 overflow-auto">
                    <table className="w-full text-xs tabular-nums">
                      <thead className="sticky top-0" style={{ background: 'var(--surface, #fff)' }}>
                        <tr className="text-left" style={{ color: 'var(--muted)' }}>
                          <th className="py-1 pr-3 font-medium">Data</th>
                          <th className="py-1 pr-3 text-right font-medium">CDI % a.a.</th>
                          <th className="py-1 pr-3 text-right font-medium">Fator diário</th>
                          <th className="py-1 pr-3 text-right font-medium">Fator acumulado</th>
                          <th className="py-1 text-right font-medium">Valor corrigido</th>
                        </tr>
                      </thead>
                      <tbody>
                        {memoriaVisivel.map((m) => (
                          <tr key={m.date} style={{ borderTop: '1px solid var(--grid, #e7eaf1)' }}>
                            <td className="py-1 pr-3">{fmtDateBr(m.date)}</td>
                            <td className="py-1 pr-3 text-right">{nf4.format(m.taxaCDI)}</td>
                            <td className="py-1 pr-3 text-right">{m.fatorDiario.toFixed(8)}</td>
                            <td className="py-1 pr-3 text-right">{m.fatorAcumulado.toFixed(8)}</td>
                            <td className="py-1 text-right">{nfBRL.format(m.valorCorrigido)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {resultado.correcao.memoria.length > memoriaVisivel.length && (
                    <p className="mt-2 text-[11px]" style={{ color: 'var(--muted)' }}>
                      Exibindo os últimos {memoriaVisivel.length} dias — a série completa está no CSV.
                    </p>
                  )}
                </section>
              )}

              {resultado.memoriaFixa && (
                <section className="card px-5 py-4" aria-label="Memória de cálculo">
                  <h2 className="text-sm font-semibold">Memória de cálculo mensal</h2>
                  <div className="mt-2 max-h-96 overflow-auto">
                    <table className="w-full text-xs tabular-nums">
                      <thead>
                        <tr className="text-left" style={{ color: 'var(--muted)' }}>
                          <th className="py-1 pr-3 font-medium">Mês</th>
                          <th className="py-1 pr-3 text-right font-medium">Taxa (%)</th>
                          <th className="py-1 pr-3 text-right font-medium">Fator</th>
                          <th className="py-1 text-right font-medium">Valor corrigido</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resultado.memoriaFixa.map((m) => (
                          <tr key={m.mes} style={{ borderTop: '1px solid var(--grid, #e7eaf1)' }}>
                            <td className="py-1 pr-3">{nf2.format(m.mes)}</td>
                            <td className="py-1 pr-3 text-right">{nf4.format(m.taxa)}</td>
                            <td className="py-1 pr-3 text-right">{m.fator.toFixed(8)}</td>
                            <td className="py-1 text-right">{nfBRL.format(m.valorCorrigido)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>

      <footer className="mt-8 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
        <p>
          Dados do CDI (série 4389) e da Selic (série 1178) da API pública do Banco Central. IRRF
          conforme Lei 11.033/2004 e IOF conforme Decreto 6.306/2007. Uso informativo.
        </p>
      </footer>
    </main>
  )
}
