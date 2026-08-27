'use client'

import { useState } from 'react'
import { buildInterpolator, type CurveInterpolator } from '../../lib/curves/interpolation'
import {
  compararEmprestimos,
  simularEmprestimo,
  type ComparacaoEmprestimos,
  type IndexadorEmprestimo,
  type ParametrosEmprestimo,
  type Periodicidade,
  type ResultadoEmprestimo,
  type SistemaAmortizacao,
} from '../../lib/financas/emprestimos'
import type { PessoaIOF } from '../../lib/financas/impostos'
import { isBusinessDay, latestExpectedDataDate, previousBusinessDay, todayInSaoPaulo } from '../../lib/dates'
import { fmtDateBr } from '../../lib/format'
import type { CurvePayload } from '../../lib/ingest'

const nfBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const inputCls = 'control mt-1 block w-full px-3 py-2 text-sm'

interface FormEmprestimo {
  nome: string
  principal: string
  dataDesembolso: string
  prazoMeses: string
  carenciaMeses: string
  carenciaCapitaliza: boolean
  periodicidade: Periodicidade
  sistema: SistemaAmortizacao
  indexador: IndexadorEmprestimo
  taxaAA: string
  percentualCDI: string
  ipcaProjetadoAA: string
  iofPessoa: '' | PessoaIOF
  tacPercentual: string
  tacValor: string
  outrasDespesas: string
}

function formPadrao(nome: string): FormEmprestimo {
  return {
    nome,
    principal: '1000000',
    dataDesembolso: todayInSaoPaulo(),
    prazoMeses: '36',
    carenciaMeses: '0',
    carenciaCapitaliza: false,
    periodicidade: 'mensal',
    sistema: 'price',
    indexador: 'cdi-spread',
    taxaAA: '',
    percentualCDI: '100',
    ipcaProjetadoAA: '4.5',
    iofPessoa: 'pj',
    tacPercentual: '',
    tacValor: '',
    outrasDespesas: '',
  }
}

function paraParametros(f: FormEmprestimo): ParametrosEmprestimo {
  return {
    nome: f.nome,
    principal: Number(f.principal),
    dataDesembolso: f.dataDesembolso,
    prazoMeses: Number(f.prazoMeses),
    carenciaMeses: Number(f.carenciaMeses) || 0,
    carenciaCapitaliza: f.carenciaCapitaliza,
    periodicidade: f.periodicidade,
    sistema: f.sistema,
    indexador: f.indexador,
    taxaAA: Number(f.taxaAA) || 0,
    percentualCDI: Number(f.percentualCDI) || 100,
    ipcaProjetadoAA: Number(f.ipcaProjetadoAA) || 0,
    despesas: {
      iofPessoa: f.iofPessoa === '' ? null : f.iofPessoa,
      tacPercentual: Number(f.tacPercentual) || 0,
      tacValor: Number(f.tacValor) || 0,
      outrasDespesas: Number(f.outrasDespesas) || 0,
    },
  }
}

const ROTULO_TAXA: Record<IndexadorEmprestimo, string> = {
  pre: 'Taxa prefixada (% a.a.)',
  'cdi-spread': 'Spread sobre o CDI (% a.a.)',
  'percentual-cdi': 'Spread adicional (% a.a., opcional)',
  'ipca-spread': 'Spread sobre o IPCA (% a.a.)',
}

function FormContrato({
  form,
  onChange,
  cor,
}: {
  form: FormEmprestimo
  onChange: (f: FormEmprestimo) => void
  cor: string
}) {
  const set = <K extends keyof FormEmprestimo>(k: K, v: FormEmprestimo[K]) =>
    onChange({ ...form, [k]: v })

  return (
    <div className="card space-y-3 px-5 py-4" style={{ borderTop: `3px solid ${cor}` }}>
      <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
        Nome do contrato
        <input value={form.nome} onChange={(e) => set('nome', e.target.value)} className={inputCls} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
          Principal (R$)
          <input type="number" step="any" min="0" value={form.principal} onChange={(e) => set('principal', e.target.value)} className={inputCls} required />
        </label>
        <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
          Desembolso
          <input type="date" value={form.dataDesembolso} onChange={(e) => set('dataDesembolso', e.target.value)} className={inputCls} required />
        </label>
        <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
          Prazo (meses)
          <input type="number" min="1" value={form.prazoMeses} onChange={(e) => set('prazoMeses', e.target.value)} className={inputCls} required />
        </label>
        <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
          Carência (meses)
          <input type="number" min="0" value={form.carenciaMeses} onChange={(e) => set('carenciaMeses', e.target.value)} className={inputCls} />
        </label>
        <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
          Periodicidade
          <select value={form.periodicidade} onChange={(e) => set('periodicidade', e.target.value as Periodicidade)} className={inputCls}>
            <option value="mensal">Mensal</option>
            <option value="trimestral">Trimestral</option>
            <option value="semestral">Semestral</option>
            <option value="anual">Anual</option>
          </select>
        </label>
        <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
          Sistema
          <select value={form.sistema} onChange={(e) => set('sistema', e.target.value as SistemaAmortizacao)} className={inputCls}>
            <option value="price">Price</option>
            <option value="sac">SAC</option>
            <option value="bullet">Bullet</option>
          </select>
        </label>
        <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
          Indexador
          <select value={form.indexador} onChange={(e) => set('indexador', e.target.value as IndexadorEmprestimo)} className={inputCls}>
            <option value="cdi-spread">CDI + spread (curva PRE)</option>
            <option value="percentual-cdi">% do CDI (curva PRE)</option>
            <option value="pre">Prefixado</option>
            <option value="ipca-spread">IPCA + spread</option>
          </select>
        </label>
        <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
          {ROTULO_TAXA[form.indexador]}
          <input type="number" step="any" value={form.taxaAA} onChange={(e) => set('taxaAA', e.target.value)} className={inputCls} />
        </label>
        {form.indexador === 'percentual-cdi' && (
          <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
            % do CDI
            <input type="number" step="any" min="1" value={form.percentualCDI} onChange={(e) => set('percentualCDI', e.target.value)} className={inputCls} />
          </label>
        )}
        {form.indexador === 'ipca-spread' && (
          <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
            IPCA projetado (% a.a.)
            <input type="number" step="any" value={form.ipcaProjetadoAA} onChange={(e) => set('ipcaProjetadoAA', e.target.value)} className={inputCls} />
          </label>
        )}
      </div>
      {Number(form.carenciaMeses) > 0 && (
        <label className="flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
          <input type="checkbox" checked={form.carenciaCapitaliza} onChange={(e) => set('carenciaCapitaliza', e.target.checked)} />
          Capitalizar juros na carência (em vez de pagá-los)
        </label>
      )}

      <fieldset className="rounded-lg border px-3 py-2.5" style={{ borderColor: 'var(--grid, #e7eaf1)' }}>
        <legend className="px-1 text-xs font-semibold">Despesas de captação</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
            IOF de crédito
            <select value={form.iofPessoa} onChange={(e) => set('iofPessoa', e.target.value as '' | PessoaIOF)} className={inputCls}>
              <option value="pj">PJ (0,0041%/dia + 0,38%)</option>
              <option value="pf">PF (0,0082%/dia + 0,38%)</option>
              <option value="">Isento / não aplicar</option>
            </select>
          </label>
          <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
            TAC / estruturação (% do principal)
            <input type="number" step="any" min="0" value={form.tacPercentual} onChange={(e) => set('tacPercentual', e.target.value)} className={inputCls} />
          </label>
          <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
            TAC / estruturação (R$ fixo)
            <input type="number" step="any" min="0" value={form.tacValor} onChange={(e) => set('tacValor', e.target.value)} className={inputCls} />
          </label>
          <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
            Outras despesas (R$)
            <input type="number" step="any" min="0" value={form.outrasDespesas} onChange={(e) => set('outrasDespesas', e.target.value)} className={inputCls} />
          </label>
        </div>
      </fieldset>
    </div>
  )
}

function ResumoContrato({ r, cor }: { r: ResultadoEmprestimo; cor: string }) {
  const [aberto, setAberto] = useState(false)
  return (
    <section className="card px-5 py-4" style={{ borderTop: `3px solid ${cor}` }}>
      <h3 className="text-sm font-semibold">{r.parametros.nome}</h3>
      <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-4">
          <dt style={{ color: 'var(--muted)' }}>CET</dt>
          <dd className="tabular-nums font-semibold">{r.cetAA !== null ? `${nf2.format(r.cetAA)}% a.a.` : '—'}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt style={{ color: 'var(--muted)' }}>Taxa sem despesas</dt>
          <dd className="tabular-nums">{r.taxaEfetivaSemDespesasAA !== null ? `${nf2.format(r.taxaEfetivaSemDespesasAA)}% a.a.` : '—'}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt style={{ color: 'var(--muted)' }}>Líquido liberado</dt>
          <dd className="tabular-nums">{nfBRL.format(r.liquidoLiberado)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt style={{ color: 'var(--muted)' }}>Despesas de captação</dt>
          <dd className="tabular-nums">{nfBRL.format(r.despesas.total)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt style={{ color: 'var(--muted)' }}>Juros totais</dt>
          <dd className="tabular-nums">{nfBRL.format(r.totalJuros)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt style={{ color: 'var(--muted)' }}>Total pago</dt>
          <dd className="tabular-nums">{nfBRL.format(r.totalPago)}</dd>
        </div>
        {r.custoVPCurva !== null && (
          <div className="flex justify-between gap-4 sm:col-span-2">
            <dt style={{ color: 'var(--muted)' }}>Custo a valor presente (curva PRE)</dt>
            <dd className="tabular-nums">{nfBRL.format(r.custoVPCurva)}</dd>
          </div>
        )}
      </dl>
      {r.despesas.iof && (
        <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
          IOF: {nfBRL.format(r.despesas.iof.total)} (diário {nfBRL.format(r.despesas.iof.iofDiario)} +
          adicional {nfBRL.format(r.despesas.iof.iofAdicional)})
          {r.despesas.tac > 0 && ` · TAC ${nfBRL.format(r.despesas.tac)}`}
          {r.despesas.outras > 0 && ` · outras ${nfBRL.format(r.despesas.outras)}`}
        </p>
      )}
      {r.avisos.map((a) => (
        <p key={a} className="mt-1 text-xs" style={{ color: 'var(--ink-2)' }}>
          ℹ {a}
        </p>
      ))}
      <button type="button" onClick={() => setAberto(!aberto)} className="chip mt-3 cursor-pointer hover:opacity-75" style={{ color: 'var(--ink-2)' }}>
        {aberto ? 'Ocultar parcelas' : `Ver parcelas (${r.parcelas.length})`}
      </button>
      {aberto && (
        <div className="mt-2 max-h-80 overflow-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="sticky top-0" style={{ background: 'var(--surface, #fff)' }}>
              <tr className="text-left" style={{ color: 'var(--muted)' }}>
                <th className="py-1 pr-2 font-medium">Nº</th>
                <th className="py-1 pr-2 font-medium">Data</th>
                <th className="py-1 pr-2 text-right font-medium">Taxa período % a.a.</th>
                <th className="py-1 pr-2 text-right font-medium">Juros</th>
                <th className="py-1 pr-2 text-right font-medium">Amortização</th>
                <th className="py-1 pr-2 text-right font-medium">Prestação</th>
                <th className="py-1 text-right font-medium">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {r.parcelas.map((p) => (
                <tr key={p.numero} style={{ borderTop: '1px solid var(--grid, #e7eaf1)' }}>
                  <td className="py-1 pr-2">{p.numero}{p.carencia ? '·c' : ''}</td>
                  <td className="py-1 pr-2">{fmtDateBr(p.data)}</td>
                  <td className="py-1 pr-2 text-right">{nf2.format(p.taxaPeriodoAA)}</td>
                  <td className="py-1 pr-2 text-right">{nf2.format(p.juros)}</td>
                  <td className="py-1 pr-2 text-right">{nf2.format(p.amortizacao)}</td>
                  <td className="py-1 pr-2 text-right">{nf2.format(p.prestacao)}</td>
                  <td className="py-1 text-right">{nf2.format(p.saldoFinal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

const COR_A = '#2a78d6'
const COR_B = '#eda100'

export default function PaginaEmprestimos() {
  const [formA, setFormA] = useState(() => formPadrao('Contrato A'))
  const [formB, setFormB] = useState(() => formPadrao('Contrato B'))
  const [comparar, setComparar] = useState(true)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [avisoCurva, setAvisoCurva] = useState<string | null>(null)
  const [resultados, setResultados] = useState<{
    a: ResultadoEmprestimo
    b: ResultadoEmprestimo | null
    comparacao: ComparacaoEmprestimos | null
    dataCurva: string | null
  } | null>(null)

  const simular = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    setAvisoCurva(null)
    setCarregando(true)
    try {
      // Curva PRE da data mais recente — estrutura a termo para projetar o CDI
      let curvaPre: CurveInterpolator | null = null
      let dataCurva: string | null = null
      try {
        const d = latestExpectedDataDate()
        const dia = isBusinessDay(d) ? d : previousBusinessDay(d)
        const res = await fetch(`/api/curves?rate=PRE&date=${dia}`)
        const body = (await res.json()) as CurvePayload
        if (res.ok && body.status === 'OK' && body.points.length > 0) {
          const points = body.points
            .map((p) => ({ days: p.days, rate: p.rate252 }))
            .filter((p): p is { days: number; rate: number } => p.rate !== null)
          curvaPre = buildInterpolator('PRE', body.date, points)
          dataCurva = body.date
        }
      } catch {
        // segue sem curva (fallback fixo, com aviso do próprio simulador)
      }
      if (!curvaPre) {
        setAvisoCurva(
          'Curva PRE indisponível — os indexadores CDI usam projeção fixa; informe uma taxa pré para resultados completos.',
        )
      }

      const a = simularEmprestimo(paraParametros(formA), curvaPre)
      const b = comparar ? simularEmprestimo(paraParametros(formB), curvaPre) : null
      setResultados({
        a,
        b,
        comparacao: b ? compararEmprestimos(a, b) : null,
        dataCurva,
      })
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err))
    } finally {
      setCarregando(false)
    }
  }

  const comp = resultados?.comparacao
  const nomeA = resultados?.a.parametros.nome ?? 'Contrato A'
  const nomeB = resultados?.b?.parametros.nome ?? 'Contrato B'

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Simulador de empréstimos</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Fluxo de caixa em datas reais com o CDI projetado pela curva PRE deste app, despesas de
          captação (IOF de crédito, TAC e outras), CET na convenção do BCB e comparação de dois
          contratos para ver qual é mais vantajoso.
        </p>
      </header>

      <form onSubmit={simular} className="space-y-4">
        <label className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--ink-2)' }}>
          <input type="checkbox" checked={comparar} onChange={(e) => setComparar(e.target.checked)} />
          Comparar com um segundo contrato
        </label>
        <div className={`grid gap-4 ${comparar ? 'lg:grid-cols-2' : 'lg:max-w-xl'}`}>
          <FormContrato form={formA} onChange={setFormA} cor={COR_A} />
          {comparar && <FormContrato form={formB} onChange={setFormB} cor={COR_B} />}
        </div>
        <button
          type="submit"
          disabled={carregando}
          className="cursor-pointer rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--accent)' }}
        >
          {carregando ? 'Simulando…' : comparar ? 'Simular e comparar' : 'Simular'}
        </button>
        {erro && (
          <p className="text-sm" role="alert" style={{ color: 'var(--danger, #b91c1c)' }}>
            ⚠ {erro}
          </p>
        )}
        {avisoCurva && (
          <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
            ℹ {avisoCurva}
          </p>
        )}
      </form>

      {resultados && (
        <div className="mt-6 space-y-4">
          {comp && resultados.b && (
            <section
              className="card px-5 py-4"
              style={{ borderColor: 'var(--accent)' }}
              aria-label="Veredito da comparação"
            >
              <h2 className="text-sm font-semibold">Qual contrato é mais vantajoso?</h2>
              <p className="mt-1 text-xl font-semibold">
                {comp.maisVantajoso === 'empate' ? (
                  'Empate técnico pelos critérios disponíveis'
                ) : (
                  <>
                    <span style={{ color: comp.maisVantajoso === 'A' ? COR_A : COR_B }}>
                      {comp.maisVantajoso === 'A' ? nomeA : nomeB}
                    </span>{' '}
                    é mais vantajoso
                  </>
                )}
              </p>
              <p className="mt-1 text-sm" style={{ color: 'var(--ink-2)' }}>
                {comp.deltaCET !== null &&
                  `Diferença de CET: ${nf2.format(Math.abs(comp.deltaCET))} pp a.a. · `}
                Diferença de total pago: {nfBRL.format(Math.abs(comp.deltaTotalPago))}
                {comp.deltaCustoVP !== null &&
                  ` · diferença de custo a valor presente: ${nfBRL.format(Math.abs(comp.deltaCustoVP))}`}
              </p>
              <div className="mt-3 overflow-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="text-left text-xs" style={{ color: 'var(--muted)' }}>
                      <th className="py-1 pr-3 font-medium">Critério (menor vence)</th>
                      <th className="py-1 pr-3 text-right font-medium" style={{ color: COR_A }}>{nomeA}</th>
                      <th className="py-1 pr-3 text-right font-medium" style={{ color: COR_B }}>{nomeB}</th>
                      <th className="py-1 text-center font-medium">Melhor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comp.criterios.map((c) => (
                      <tr key={c.criterio} style={{ borderTop: '1px solid var(--grid, #e7eaf1)' }}>
                        <td className="py-1.5 pr-3">{c.criterio}</td>
                        <td className="py-1.5 pr-3 text-right">
                          {c.valorA === null ? '—' : c.criterio.includes('R$') ? nfBRL.format(c.valorA) : nf2.format(c.valorA)}
                        </td>
                        <td className="py-1.5 pr-3 text-right">
                          {c.valorB === null ? '—' : c.criterio.includes('R$') ? nfBRL.format(c.valorB) : nf2.format(c.valorB)}
                        </td>
                        <td className="py-1.5 text-center font-semibold" style={{ color: c.melhor === 'A' ? COR_A : c.melhor === 'B' ? COR_B : 'var(--muted)' }}>
                          {c.melhor ?? '='}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {resultados.dataCurva && (
                <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                  CDI projetado pelos fatores a termo da curva PRE de {fmtDateBr(resultados.dataCurva)};
                  custo a valor presente descontado na mesma curva. CET na convenção do BCB
                  (expoente dc/365, sobre o valor líquido liberado).
                </p>
              )}
            </section>
          )}

          <div className={`grid gap-4 ${resultados.b ? 'lg:grid-cols-2' : 'lg:max-w-2xl'}`}>
            <ResumoContrato r={resultados.a} cor={COR_A} />
            {resultados.b && <ResumoContrato r={resultados.b} cor={COR_B} />}
          </div>
        </div>
      )}

      <footer className="mt-8 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
        <p>
          IOF de crédito conforme Decreto 6.306/2007 (alíquota diária limitada a 365 dias +
          adicional de 0,38%); CET conforme Resolução CMN 3.517. Datas ajustadas ao dia útil
          seguinte no calendário ANBIMA. Simulação de uso informativo.
        </p>
      </footer>
    </main>
  )
}
