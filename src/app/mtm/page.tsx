'use client'

import { useState } from 'react'
import { latestExpectedDataDate, previousBusinessDay, isBusinessDay } from '../../lib/dates'

type Aba = 'ndf' | 'swap' | 'opcao'

const nfBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const nf4 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
const nf6 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 6 })

function hojeUtil(): string {
  const d = latestExpectedDataDate()
  return isBusinessDay(d) ? d : previousBusinessDay(d)
}

function Campo({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
      {label}
      {children}
    </label>
  )
}

const inputCls = 'control mt-1 block w-full px-3 py-2 text-sm'

function useConsulta<T>() {
  const [estado, setEstado] = useState<{ loading: boolean; data?: T; error?: string }>({
    loading: false,
  })
  const consultar = async (url: string) => {
    setEstado({ loading: true })
    try {
      const res = await fetch(url)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setEstado({ loading: false, data: body as T })
    } catch (err) {
      setEstado({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { ...estado, consultar }
}

function MtMDestaque({ valor, rotulo }: { valor: number; rotulo: string }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        {rotulo}
      </p>
      <p
        className="text-2xl font-semibold tabular-nums"
        style={{ color: valor >= 0 ? 'var(--accent)' : 'var(--danger, #b91c1c)' }}
      >
        {nfBRL.format(valor)}
      </p>
    </div>
  )
}

// ========== NDF ==========

interface RespostaNDF {
  forward: number
  taxaDesconto: number
  fatorDesconto: number
  diferencaCambial: number
  mtmBruto: number
  mtmFinal: number
  dc: number
  du: number
  curvaForward: { code: string; nome: string }
}

function PainelNDF() {
  const [moeda, setMoeda] = useState('USD')
  const [posicao, setPosicao] = useState('comprada')
  const [montante, setMontante] = useState('1000000')
  const [taxaContrato, setTaxaContrato] = useState('')
  const [dataMtM, setDataMtM] = useState(hojeUtil())
  const [vencimento, setVencimento] = useState('')
  const { loading, data, error, consultar } = useConsulta<RespostaNDF>()

  const submeter = (e: React.FormEvent) => {
    e.preventDefault()
    const params = new URLSearchParams({
      moeda,
      posicao,
      montante,
      taxaContrato,
      dataMtM,
      vencimento,
    })
    consultar(`/api/mtm/ndf?${params}`)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(18rem,22rem)_1fr]">
      <form onSubmit={submeter} className="card space-y-3 px-5 py-4">
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Moeda">
            <select value={moeda} onChange={(e) => setMoeda(e.target.value)} className={inputCls}>
              <option value="USD">USD — dólar</option>
              <option value="EUR">EUR — euro</option>
              <option value="JPY">JPY — iene</option>
            </select>
          </Campo>
          <Campo label="Posição">
            <select value={posicao} onChange={(e) => setPosicao(e.target.value)} className={inputCls}>
              <option value="comprada">Comprada (comprou a termo)</option>
              <option value="vendida">Vendida (vendeu a termo)</option>
            </select>
          </Campo>
        </div>
        <Campo label={`Montante (${moeda})`}>
          <input type="number" step="any" min="0" value={montante} onChange={(e) => setMontante(e.target.value)} className={inputCls} required />
        </Campo>
        <Campo label="Taxa contratada (R$ por unidade)">
          <input type="number" step="any" min="0" value={taxaContrato} onChange={(e) => setTaxaContrato(e.target.value)} className={inputCls} required />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Data de MtM (curvas)">
            <input type="date" value={dataMtM} onChange={(e) => setDataMtM(e.target.value)} className={inputCls} required />
          </Campo>
          <Campo label="Vencimento">
            <input type="date" value={vencimento} min={dataMtM} onChange={(e) => setVencimento(e.target.value)} className={inputCls} required />
          </Campo>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--accent)' }}
        >
          {loading ? 'Calculando…' : 'Calcular MtM'}
        </button>
        {error && (
          <p className="text-xs" role="alert" style={{ color: 'var(--danger, #b91c1c)' }}>
            ⚠ {error}
          </p>
        )}
      </form>

      <div className="space-y-3">
        {!data && !loading && (
          <div className="card px-5 py-4 text-sm" style={{ color: 'var(--muted)' }}>
            MtM = ±Montante × (Forward − Taxa contratada) / (1 + pré)^(du/252). O forward vem da
            curva de preço da moeda ({moeda === 'USD' ? 'PTX' : moeda}) e o desconto da curva PRE,
            ambas interpoladas pela regra do Manual de Curvas da B3 na data de MtM.
          </div>
        )}
        {data && (
          <>
            <MtMDestaque valor={data.mtmFinal} rotulo="MtM da posição (R$)" />
            <div className="card px-5 py-4">
              <dl className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-4">
                  <dt style={{ color: 'var(--muted)' }}>Forward interpolado ({data.curvaForward.code})</dt>
                  <dd className="tabular-nums font-medium">{nf4.format(data.forward)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt style={{ color: 'var(--muted)' }}>Diferença cambial</dt>
                  <dd className="tabular-nums">{nf4.format(data.diferencaCambial)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt style={{ color: 'var(--muted)' }}>Taxa PRE de desconto</dt>
                  <dd className="tabular-nums">{nf4.format(data.taxaDesconto)}% a.a.</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt style={{ color: 'var(--muted)' }}>Fator de desconto (trunc 12)</dt>
                  <dd className="tabular-nums">{data.fatorDesconto.toFixed(8)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt style={{ color: 'var(--muted)' }}>MtM bruto (sem desconto)</dt>
                  <dd className="tabular-nums">{nfBRL.format(data.mtmBruto)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt style={{ color: 'var(--muted)' }}>Prazo</dt>
                  <dd className="tabular-nums">
                    {data.dc} dc · {data.du} du
                  </dd>
                </div>
              </dl>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ========== Swap ==========

interface RespostaSwap {
  mtmFinal: number
  taxaDesconto: number
  fatorDesconto: number
  duTotal: number
  duDecorrido: number
  duRestante: number
  fatorCDIAcumulado: number | null
  ptaxInicial: number | null
  ptaxMtM: number | null
  ativa: { valorFuturo: number; valorPresente: number; detalhe: string }
  passiva: { valorFuturo: number; valorPresente: number; detalhe: string }
  avisos: string[]
}

function CamposPerna({
  titulo,
  tipo,
  setTipo,
  taxa,
  setTaxa,
  pct,
  setPct,
}: {
  titulo: string
  tipo: string
  setTipo: (v: string) => void
  taxa: string
  setTaxa: (v: string) => void
  pct: string
  setPct: (v: string) => void
}) {
  const usaPct = tipo === 'cdi' || tipo === 'selic'
  const rotuloTaxa =
    tipo === 'pre' ? 'Taxa pré (% a.a.)'
    : tipo === 'ipca' ? 'IPCA + spread — taxa total projetada (% a.a.)'
    : tipo === 'dolar' ? 'Cupom cambial (% a.a., linear 360)'
    : 'Spread (% a.a., opcional)'
  return (
    <fieldset className="rounded-lg border px-3 py-2.5" style={{ borderColor: 'var(--grid, #e7eaf1)' }}>
      <legend className="px-1 text-xs font-semibold">{titulo}</legend>
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Indexador">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputCls}>
            <option value="cdi">CDI</option>
            <option value="selic">Selic</option>
            <option value="pre">Pré</option>
            <option value="ipca">IPCA + spread</option>
            <option value="dolar">Dólar + cupom</option>
          </select>
        </Campo>
        {usaPct ? (
          <Campo label="% do indexador">
            <input type="number" step="any" min="1" value={pct} onChange={(e) => setPct(e.target.value)} className={inputCls} />
          </Campo>
        ) : (
          <span />
        )}
      </div>
      <Campo label={rotuloTaxa}>
        <input type="number" step="any" min="0" value={taxa} onChange={(e) => setTaxa(e.target.value)} className={inputCls} />
      </Campo>
    </fieldset>
  )
}

function PainelSwap() {
  const [vn, setVn] = useState('10000000')
  const [ativaTipo, setAtivaTipo] = useState('cdi')
  const [ativaTaxa, setAtivaTaxa] = useState('0')
  const [ativaPct, setAtivaPct] = useState('100')
  const [passivaTipo, setPassivaTipo] = useState('pre')
  const [passivaTaxa, setPassivaTaxa] = useState('')
  const [passivaPct, setPassivaPct] = useState('100')
  const [dataContratacao, setDataContratacao] = useState('')
  const [dataMtM, setDataMtM] = useState(hojeUtil())
  const [vencimento, setVencimento] = useState('')
  const { loading, data, error, consultar } = useConsulta<RespostaSwap>()

  const submeter = (e: React.FormEvent) => {
    e.preventDefault()
    const params = new URLSearchParams({
      vn,
      ativaTipo,
      ativaTaxa: ativaTaxa || '0',
      ativaPct,
      passivaTipo,
      passivaTaxa: passivaTaxa || '0',
      passivaPct,
      dataContratacao,
      dataMtM,
      vencimento,
    })
    consultar(`/api/mtm/swap?${params}`)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(20rem,26rem)_1fr]">
      <form onSubmit={submeter} className="card space-y-3 px-5 py-4">
        <Campo label="Valor nocional (R$)">
          <input type="number" step="any" min="0" value={vn} onChange={(e) => setVn(e.target.value)} className={inputCls} required />
        </Campo>
        <CamposPerna titulo="Perna ativa (recebe)" tipo={ativaTipo} setTipo={setAtivaTipo} taxa={ativaTaxa} setTaxa={setAtivaTaxa} pct={ativaPct} setPct={setAtivaPct} />
        <CamposPerna titulo="Perna passiva (paga)" tipo={passivaTipo} setTipo={setPassivaTipo} taxa={passivaTaxa} setTaxa={setPassivaTaxa} pct={passivaPct} setPct={setPassivaPct} />
        <div className="grid grid-cols-3 gap-3">
          <Campo label="Contratação">
            <input type="date" value={dataContratacao} onChange={(e) => setDataContratacao(e.target.value)} className={inputCls} required />
          </Campo>
          <Campo label="Data de MtM">
            <input type="date" value={dataMtM} min={dataContratacao} onChange={(e) => setDataMtM(e.target.value)} className={inputCls} required />
          </Campo>
          <Campo label="Vencimento">
            <input type="date" value={vencimento} min={dataMtM} onChange={(e) => setVencimento(e.target.value)} className={inputCls} required />
          </Campo>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--accent)' }}
        >
          {loading ? 'Calculando…' : 'Calcular MtM'}
        </button>
        {error && (
          <p className="text-xs" role="alert" style={{ color: 'var(--danger, #b91c1c)' }}>
            ⚠ {error}
          </p>
        )}
      </form>

      <div className="space-y-3">
        {!data && !loading && (
          <div className="card px-5 py-4 text-sm" style={{ color: 'var(--muted)' }}>
            MtM = VP(perna ativa) − VP(perna passiva), descontado pela curva PRE da data de MtM. O
            fator CDI/Selic acumulado desde a contratação é calculado automaticamente da série
            oficial do BCB; a PTAX das pernas em dólar também.
          </div>
        )}
        {data && (
          <>
            <MtMDestaque valor={data.mtmFinal} rotulo="MtM do swap (R$)" />
            <div className="card px-5 py-4 text-sm">
              <div className="grid gap-4 sm:grid-cols-2">
                {(['ativa', 'passiva'] as const).map((lado) => (
                  <div key={lado}>
                    <p className="text-xs font-semibold uppercase" style={{ color: 'var(--muted)' }}>
                      Perna {lado}
                    </p>
                    <p className="mt-1 tabular-nums">VP: {nfBRL.format(data[lado].valorPresente)}</p>
                    <p className="tabular-nums" style={{ color: 'var(--ink-2)' }}>
                      VF: {nfBRL.format(data[lado].valorFuturo)}
                    </p>
                    <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                      {data[lado].detalhe}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
                Desconto: PRE {nf4.format(data.taxaDesconto)}% a.a. · fator {data.fatorDesconto.toFixed(8)} ·{' '}
                {data.duDecorrido} du decorridos · {data.duRestante} du restantes de {data.duTotal} du.
              </p>
              {data.avisos.map((a) => (
                <p key={a} className="mt-1 text-xs" style={{ color: 'var(--ink-2)' }}>
                  ℹ {a}
                </p>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ========== Opção de moeda OTC ==========

interface RespostaOpcao {
  forward: number
  taxaDesconto: number
  fatorDesconto: number
  premio: number
  premioTotal: number
  intrinseco: number
  valorTempo: number
  d1: number
  d2: number
  dc: number
  du: number
  valorPosicao: number
  resultadoVsPremio: number | null
  gregas: { deltaForward: number; gamma: number; vega: number; thetaDiaUtil: number }
  curvaForward: { code: string } | null
}

function PainelOpcao() {
  const [moeda, setMoeda] = useState('USD')
  const [tipo, setTipo] = useState('call')
  const [posicao, setPosicao] = useState('comprada')
  const [montante, setMontante] = useState('1000000')
  const [strike, setStrike] = useState('')
  const [vol, setVol] = useState('15')
  const [dataMtM, setDataMtM] = useState(hojeUtil())
  const [vencimento, setVencimento] = useState('')
  const [premioContratado, setPremioContratado] = useState('')
  const { loading, data, error, consultar } = useConsulta<RespostaOpcao>()

  const submeter = (e: React.FormEvent) => {
    e.preventDefault()
    const params = new URLSearchParams({
      moeda,
      tipo,
      posicao,
      montante,
      strike,
      vol,
      dataMtM,
      vencimento,
    })
    if (premioContratado) params.set('premioContratado', premioContratado)
    consultar(`/api/mtm/fx-option?${params}`)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(18rem,22rem)_1fr]">
      <form onSubmit={submeter} className="card space-y-3 px-5 py-4">
        <div className="grid grid-cols-3 gap-3">
          <Campo label="Moeda">
            <select value={moeda} onChange={(e) => setMoeda(e.target.value)} className={inputCls}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="JPY">JPY</option>
            </select>
          </Campo>
          <Campo label="Tipo">
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputCls}>
              <option value="call">Call</option>
              <option value="put">Put</option>
            </select>
          </Campo>
          <Campo label="Posição">
            <select value={posicao} onChange={(e) => setPosicao(e.target.value)} className={inputCls}>
              <option value="comprada">Comprada</option>
              <option value="vendida">Vendida</option>
            </select>
          </Campo>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo label={`Montante (${moeda})`}>
            <input type="number" step="any" min="0" value={montante} onChange={(e) => setMontante(e.target.value)} className={inputCls} required />
          </Campo>
          <Campo label="Strike (R$)">
            <input type="number" step="any" min="0" value={strike} onChange={(e) => setStrike(e.target.value)} className={inputCls} required />
          </Campo>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Vol implícita (% a.a.)">
            <input type="number" step="any" min="0" value={vol} onChange={(e) => setVol(e.target.value)} className={inputCls} required />
          </Campo>
          <Campo label="Prêmio contratado (R$/un., opcional)">
            <input type="number" step="any" min="0" value={premioContratado} onChange={(e) => setPremioContratado(e.target.value)} className={inputCls} />
          </Campo>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Data de MtM (curvas)">
            <input type="date" value={dataMtM} onChange={(e) => setDataMtM(e.target.value)} className={inputCls} required />
          </Campo>
          <Campo label="Vencimento">
            <input type="date" value={vencimento} min={dataMtM} onChange={(e) => setVencimento(e.target.value)} className={inputCls} required />
          </Campo>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--accent)' }}
        >
          {loading ? 'Calculando…' : 'Precificar / MtM'}
        </button>
        {error && (
          <p className="text-xs" role="alert" style={{ color: 'var(--danger, #b91c1c)' }}>
            ⚠ {error}
          </p>
        )}
      </form>

      <div className="space-y-3">
        {!data && !loading && (
          <div className="card px-5 py-4 text-sm" style={{ color: 'var(--muted)' }}>
            Opções de moeda OTC pelo modelo de Black sobre o forward (equivalente a
            Garman–Kohlhagen): o forward vem da curva de preço da moeda na B3, o desconto da curva
            PRE e a volatilidade é informada em % a.a. (base 252 dias úteis).
          </div>
        )}
        {data && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <MtMDestaque valor={data.valorPosicao} rotulo="Valor de mercado da posição (R$)" />
              {data.resultadoVsPremio !== null ? (
                <MtMDestaque valor={data.resultadoVsPremio} rotulo="Resultado vs. prêmio contratado (R$)" />
              ) : (
                <div className="card px-4 py-3">
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    Prêmio justo total (R$)
                  </p>
                  <p className="text-2xl font-semibold tabular-nums">{nfBRL.format(data.premioTotal)}</p>
                </div>
              )}
            </div>
            <div className="card px-5 py-4">
              <dl className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-4">
                  <dt style={{ color: 'var(--muted)' }}>Prêmio unitário (R$/un.)</dt>
                  <dd className="tabular-nums font-medium">{nf6.format(data.premio)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt style={{ color: 'var(--muted)' }}>Forward {data.curvaForward ? `(${data.curvaForward.code})` : '(manual)'}</dt>
                  <dd className="tabular-nums">{nf4.format(data.forward)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt style={{ color: 'var(--muted)' }}>Intrínseco / tempo</dt>
                  <dd className="tabular-nums">
                    {nf6.format(data.intrinseco)} / {nf6.format(data.valorTempo)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt style={{ color: 'var(--muted)' }}>PRE de desconto</dt>
                  <dd className="tabular-nums">{nf4.format(data.taxaDesconto)}% a.a.</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt style={{ color: 'var(--muted)' }}>d1 / d2</dt>
                  <dd className="tabular-nums">
                    {nf4.format(data.d1)} / {nf4.format(data.d2)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt style={{ color: 'var(--muted)' }}>Prazo</dt>
                  <dd className="tabular-nums">
                    {data.dc} dc · {data.du} du
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs font-semibold uppercase" style={{ color: 'var(--muted)' }}>
                Gregas (por unidade)
              </p>
              <dl className="mt-1 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-4">
                  <dt style={{ color: 'var(--muted)' }}>Delta (forward)</dt>
                  <dd className="tabular-nums">{nf4.format(data.gregas.deltaForward)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt style={{ color: 'var(--muted)' }}>Gamma</dt>
                  <dd className="tabular-nums">{nf6.format(data.gregas.gamma)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt style={{ color: 'var(--muted)' }}>Vega (por 1 pp de vol)</dt>
                  <dd className="tabular-nums">{nf6.format(data.gregas.vega)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt style={{ color: 'var(--muted)' }}>Theta (por dia útil)</dt>
                  <dd className="tabular-nums">{nf6.format(data.gregas.thetaDiaUtil)}</dd>
                </div>
              </dl>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ========== Página ==========

const ABAS: Array<{ id: Aba; label: string }> = [
  { id: 'ndf', label: 'NDF (termo de moeda)' },
  { id: 'swap', label: 'Swap' },
  { id: 'opcao', label: 'Opção de moeda OTC' },
]

export default function PaginaMtM() {
  const [aba, setAba] = useState<Aba>('ndf')
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Marcação a mercado</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          NDF, swaps e opções de moeda OTC apreçados com as curvas da B3 armazenadas neste app —
          interpolação pelo Manual de Curvas, séries CDI/Selic/PTAX oficiais do BCB.
        </p>
      </header>

      <div role="tablist" aria-label="Instrumento" className="mb-4 flex flex-wrap gap-1.5">
        {ABAS.map((a) => (
          <button
            key={a.id}
            role="tab"
            aria-selected={aba === a.id}
            onClick={() => setAba(a.id)}
            className="chip cursor-pointer px-3 py-1.5 text-sm hover:opacity-80"
            style={
              aba === a.id
                ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
                : { color: 'var(--ink-2)' }
            }
          >
            {a.label}
          </button>
        ))}
      </div>

      {aba === 'ndf' && <PainelNDF />}
      {aba === 'swap' && <PainelSwap />}
      {aba === 'opcao' && <PainelOpcao />}

      <footer className="mt-8 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
        <p>
          Metodologias: NDF = ±M·(F−K)/(1+pré)^(du/252) com F da curva de preço da moeda; swap =
          diferença dos valores presentes das pernas descontadas na curva PRE; opções pelo modelo de
          Black sobre o forward. Valores de uso informativo — confira as curvas oficiais na B3.
        </p>
      </footer>
    </main>
  )
}
