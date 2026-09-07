import { NextResponse } from 'next/server'
import { badRequest, parseDateParam } from '../../../../lib/api'
import { fetchPTAXAte, fetchSGS, SGS_CDI, SGS_SELIC } from '../../../../lib/bcb'
import { fatorCDIEntre } from '../../../../lib/financas/cdi'
import { CurvaIndisponivelError, carregarInterpolador } from '../../../../lib/financas/curvas-server'
import {
  calcularSwapMtM,
  type PernaSwap,
  type TipoPernaSwap,
} from '../../../../lib/financas/mtm'
import { isValidISODate } from '../../../../lib/dates'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TIPOS: TipoPernaSwap[] = ['cdi', 'selic', 'pre', 'ipca', 'dolar']

function parsePerna(url: URL, prefixo: 'ativa' | 'passiva'): PernaSwap | string {
  const tipo = url.searchParams.get(`${prefixo}Tipo`) as TipoPernaSwap | null
  if (!tipo || !TIPOS.includes(tipo)) {
    return `Parâmetro "${prefixo}Tipo" inválido (${TIPOS.join(', ')}).`
  }
  const taxa = Number(url.searchParams.get(`${prefixo}Taxa`) ?? '0')
  if (!Number.isFinite(taxa) || taxa < 0) return `Parâmetro "${prefixo}Taxa" inválido.`
  const pctRaw = url.searchParams.get(`${prefixo}Pct`)
  const percentualIndexador = pctRaw !== null && pctRaw !== '' ? Number(pctRaw) : undefined
  if (percentualIndexador !== undefined && (!Number.isFinite(percentualIndexador) || percentualIndexador <= 0)) {
    return `Parâmetro "${prefixo}Pct" inválido.`
  }
  return { tipo, taxa, percentualIndexador }
}

/**
 * GET /api/mtm/swap?vn=10000000&ativaTipo=cdi&ativaPct=100&passivaTipo=pre
 *   &passivaTaxa=12.5&dataContratacao=2025-08-26&dataMtM=2026-08-25
 *   &vencimento=2027-08-26[&fatorCDI=…][&ptaxInicial=…][&ptaxMtM=…]
 *
 * MtM de swap: pernas CDI/Selic (fator acumulado real do BCB), pré, IPCA e
 * dólar+cupom, descontadas pela curva PRE da data de MtM. O fator CDI/Selic é
 * calculado automaticamente da série do BCB quando não for informado.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const vn = Number(url.searchParams.get('vn'))
  const dataContratacao = parseDateParam(url.searchParams.get('dataContratacao'))
  const dataMtM = parseDateParam(url.searchParams.get('dataMtM'))
  const vencimento = url.searchParams.get('vencimento')?.trim() ?? ''

  if (!Number.isFinite(vn) || vn <= 0) return badRequest('Valor nocional inválido.')
  if (!dataContratacao) return badRequest('Parâmetro "dataContratacao" inválido (AAAA-MM-DD).')
  if (!dataMtM || dataMtM < dataContratacao) {
    return badRequest('Parâmetro "dataMtM" inválido (a partir da contratação).')
  }
  if (!isValidISODate(vencimento) || vencimento <= dataMtM) {
    return badRequest('Parâmetro "vencimento" inválido (posterior à data de MtM).')
  }

  const ativa = parsePerna(url, 'ativa')
  if (typeof ativa === 'string') return badRequest(ativa)
  const passiva = parsePerna(url, 'passiva')
  if (typeof passiva === 'string') return badRequest(passiva)

  const fatorRaw = url.searchParams.get('fatorCDI')
  let fatorCDIAcumulado = fatorRaw !== null && fatorRaw !== '' ? Number(fatorRaw) : undefined
  if (fatorCDIAcumulado !== undefined && (!Number.isFinite(fatorCDIAcumulado) || fatorCDIAcumulado <= 0)) {
    return badRequest('Parâmetro "fatorCDI" inválido.')
  }
  const ptaxIniRaw = url.searchParams.get('ptaxInicial')
  const ptaxMtMRaw = url.searchParams.get('ptaxMtM')
  let ptaxInicial = ptaxIniRaw !== null && ptaxIniRaw !== '' ? Number(ptaxIniRaw) : undefined
  let ptaxMtM = ptaxMtMRaw !== null && ptaxMtMRaw !== '' ? Number(ptaxMtMRaw) : undefined

  const avisos: string[] = []

  try {
    const pre = await carregarInterpolador('PRE', dataMtM)

    // Fator CDI/Selic acumulado da contratação até o MtM (série real do BCB)
    const pernaIndexada = [ativa, passiva].find((p) => p.tipo === 'cdi' || p.tipo === 'selic')
    if (pernaIndexada && fatorCDIAcumulado === undefined) {
      const serie = await fetchSGS(
        pernaIndexada.tipo === 'selic' ? SGS_SELIC : SGS_CDI,
        dataContratacao,
        dataMtM,
      )
      if (serie.length === 0) {
        return badRequest('Sem série do indexador no BCB para o período da contratação ao MtM.')
      }
      fatorCDIAcumulado = fatorCDIEntre(
        serie,
        dataContratacao,
        dataMtM,
        pernaIndexada.percentualIndexador ?? 100,
      )
      avisos.push(
        `Fator ${pernaIndexada.tipo === 'selic' ? 'Selic' : 'CDI'} acumulado calculado da série do BCB: ${fatorCDIAcumulado.toFixed(8)} (${serie.length} dias úteis).`,
      )
    }

    // PTAX automática para perna dólar
    const temDolar = ativa.tipo === 'dolar' || passiva.tipo === 'dolar'
    if (temDolar) {
      if (ptaxInicial === undefined) {
        const p = await fetchPTAXAte(dataContratacao)
        if (!p) return badRequest('PTAX da contratação indisponível no BCB — informe ptaxInicial.')
        ptaxInicial = p.valor
        avisos.push(`PTAX inicial ${p.valor.toFixed(4)} (${p.date}) obtida do BCB.`)
      }
      if (ptaxMtM === undefined) {
        const p = await fetchPTAXAte(dataMtM)
        if (!p) return badRequest('PTAX da data de MtM indisponível no BCB — informe ptaxMtM.')
        ptaxMtM = p.valor
        avisos.push(`PTAX no MtM ${p.valor.toFixed(4)} (${p.date}) obtida do BCB.`)
      }
    }

    const resultado = calcularSwapMtM(
      {
        valorNocional: vn,
        pernaAtiva: ativa,
        pernaPassiva: passiva,
        dataContratacao,
        dataVencimento: vencimento,
        dataMtM,
        fatorCDIAcumulado,
        ptaxInicial,
        ptaxMtM,
      },
      pre.interp,
    )

    const res = NextResponse.json({
      valorNocional: vn,
      dataContratacao,
      dataMtM,
      vencimento,
      pernaAtiva: ativa,
      pernaPassiva: passiva,
      fatorCDIAcumulado: fatorCDIAcumulado ?? null,
      ptaxInicial: ptaxInicial ?? null,
      ptaxMtM: ptaxMtM ?? null,
      curvaDesconto: { code: 'PRE', nome: pre.rate.name, vertices: pre.vertices },
      avisos,
      ...resultado,
    })
    res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600')
    return res
  } catch (err) {
    if (err instanceof CurvaIndisponivelError) {
      return NextResponse.json(
        { error: err.message, status: err.status, nearestAvailable: err.nearestAvailable },
        { status: 404 },
      )
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
