import { NextResponse } from 'next/server'
import { latestExpectedDataDate, previousBusinessDay, toUTCDate } from '../../../../lib/dates'
import { prisma } from '../../../../lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

interface Probe {
  label: string
  url: string
  status?: number
  contentType?: string | null
  server?: string | null
  cfRay?: string | null
  len?: number
  markers?: Record<string, boolean>
  bodySlice?: string
  iframeSrc?: string | null
  error?: string
}

async function probe(label: string, url: string, accept: string): Promise<Probe & { raw?: string }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'pt-BR,pt;q=0.9', Referer: 'https://www2.bmf.com.br/' },
      signal: AbortSignal.timeout(18_000),
      cache: 'no-store',
    })
    const raw = await res.text()
    const low = raw.toLowerCase()
    const markers = {
      slcTaxa: /slctaxa/i.test(raw),
      diasCorridos: /dias\s+corridos/i.test(raw),
      iframe: /<iframe/i.test(raw),
      table: /<table/i.test(raw),
      txref: /txref/i.test(raw),
      cfChallenge: low.includes('just a moment') || low.includes('cf-mitigated') || low.includes('attention required') || low.includes('enable javascript and cookies'),
    }
    const iframeSrc = /<iframe[^>]+src=["']([^"']+)["']/i.exec(raw)?.[1] ?? null
    // slice around the most interesting marker
    let anchor = 0
    for (const kw of ['dias corridos', 'slctaxa', '<table', '<iframe', 'txref']) {
      const i = low.indexOf(kw)
      if (i >= 0) { anchor = Math.max(0, i - 80); break }
    }
    return {
      label, url,
      status: res.status,
      contentType: res.headers.get('content-type'),
      server: res.headers.get('server'),
      cfRay: res.headers.get('cf-ray'),
      len: raw.length,
      markers,
      iframeSrc,
      bodySlice: raw.slice(anchor, anchor + 600).replace(/\s+/g, ' '),
      raw,
    }
  } catch (err) {
    return { label, url, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }
  }
}

/**
 * Sondagem diagnóstica da B3. Sem autenticação por design: consulta apenas
 * páginas públicas da B3 e não expõe nenhum dado interno. Além de responder o
 * JSON, persiste o resultado em FetchLog sob o código '_DIAG' (inativo, nunca
 * aparece no dropdown) para que a investigação possa ser lida direto no banco.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const date = url.searchParams.get('date') ?? previousBusinessDay(latestExpectedDataDate())
  const [y, m, d] = date.split('-')
  const br = `${d}/${m}/${y}`
  const compact = `${y}${m}${d}`

  const candidates: Array<[string, string, string]> = [
    ['legacy_wrapper', `https://www2.bmf.com.br/pages/portal/bmfbovespa/lumis/lum-taxas-referenciais-bmf-ptBR.asp?Data=${encodeURIComponent(br)}&Data1=${compact}&slcTaxa=PRE`, 'text/html'],
    ['legacy_txref1', `https://www2.bmf.com.br/pages/portal/bmfbovespa/boletim1/TxRef1.asp?Data=${encodeURIComponent(br)}&Data1=${compact}&slcTaxa=PRE`, 'text/html'],
    ['modern_spa', `https://sistemaswebb3-derivativos.b3.com.br/referenceRatesPage/all?language=pt-br`, 'text/html'],
  ]

  const probes = await Promise.all(candidates.map(([l, u, a]) => probe(l, u, a)))

  // A partir da SPA moderna, extrai os assets e garimpa nos bundles JS o
  // caminho da API de dados (proxy) que alimenta a página.
  const spa = probes.find((p) => p.label === 'modern_spa')
  const assets: string[] = []
  const apiHints: string[] = []
  if (spa?.raw) {
    const base = 'https://sistemaswebb3-derivativos.b3.com.br'
    for (const mm of spa.raw.matchAll(/<(?:script|link)[^>]+(?:src|href)=["']([^"']+\.(?:js|css))["']/gi)) {
      let a = mm[1]
      if (a.startsWith('//')) a = 'https:' + a
      else if (a.startsWith('/')) a = base + a
      else if (!a.startsWith('http')) a = base + '/referenceRatesPage/' + a
      if (a.endsWith('.js') && !assets.includes(a)) assets.push(a)
    }
    for (const jsUrl of assets.slice(0, 6)) {
      try {
        const r = await fetch(jsUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000), cache: 'no-store' })
        const js = await r.text()
        for (const mm of js.matchAll(/["'`]([^"'`]*(?:[Pp]roxy|referenceRate|ReferenceRate|TaxasRef)[^"'`]*)["'`]/g)) {
          const s = mm[1]
          if (s.length < 200 && !apiHints.includes(s)) apiHints.push(s)
          if (apiHints.length >= 40) break
        }
      } catch {
        // falha em asset individual não invalida a sondagem
      }
      if (apiHints.length >= 40) break
    }
  }

  const clean = probes.map(({ raw, ...rest }) => rest)
  const result = {
    ranAt: new Date().toISOString(),
    date,
    region: process.env.VERCEL_REGION ?? null,
    probes: clean,
    assets: assets.slice(0, 10),
    apiHints,
  }

  // Persiste para leitura via SQL (melhor esforço: a sondagem responde mesmo
  // se o banco estiver indisponível).
  let persisted = false
  try {
    await prisma.rateType.upsert({
      where: { code: '_DIAG' },
      create: { code: '_DIAG', name: 'Sondagem diagnóstica (interno)', active: false },
      update: { active: false },
    })
    await prisma.fetchLog.upsert({
      where: { rateCode_date: { rateCode: '_DIAG', date: toUTCDate(date) } },
      create: { rateCode: '_DIAG', date: toUTCDate(date), status: 'ERROR', points: 0, message: JSON.stringify(result) },
      update: { status: 'ERROR', points: 0, message: JSON.stringify(result), fetchedAt: new Date() },
    })
    persisted = true
  } catch {
    // sem banco, ainda devolvemos o JSON na resposta
  }

  return NextResponse.json({ ...result, persisted })
}
