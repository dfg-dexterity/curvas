import { NextResponse } from 'next/server'
import { latestExpectedDataDate, previousBusinessDay, toUTCDate } from '../../../../lib/dates'
import { prisma } from '../../../../lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const SPA_BASE = 'https://sistemaswebb3-derivativos.b3.com.br'
const PROXY_BASE = `${SPA_BASE}/referenceRatesProxy/`

interface CallProbe {
  url: string
  status?: number
  contentType?: string | null
  len?: number
  head?: string
  error?: string
}

async function fetchText(url: string, accept: string): Promise<{ res?: Response; text?: string; error?: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: accept,
        'Accept-Language': 'pt-BR,pt;q=0.9',
        Referer: `${SPA_BASE}/referenceRatesPage/`,
      },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    })
    return { res, text: await res.text() }
  } catch (err) {
    return { error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }
  }
}

async function probeCall(url: string, accept = 'application/json, text/plain, */*'): Promise<CallProbe> {
  const { res, text, error } = await fetchText(url, accept)
  if (error || !res) return { url, error }
  return {
    url,
    status: res.status,
    contentType: res.headers.get('content-type'),
    len: text?.length ?? 0,
    head: (text ?? '').slice(0, 300).replace(/\s+/g, ' '),
  }
}

/**
 * Sondagem diagnóstica v2 da API moderna de Taxas Referenciais da B3.
 * Sem autenticação por design: consulta apenas endpoints públicos da B3 e não
 * expõe dados internos. Baixa o bundle principal da SPA, extrai as janelas de
 * código ao redor de cada uso de "referenceRatesProxy" (para revelar como as
 * chamadas são montadas) e testa candidatos diretos, incluindo o CSV.
 * O resultado completo é persistido em FetchLog sob o código '_DIAG'.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const date = url.searchParams.get('date') ?? previousBusinessDay(latestExpectedDataDate())
  const [y, m, d] = date.split('-')
  const br = `${d}/${m}/${y}`

  // 1. HTML da SPA -> lista de bundles JS.
  const spa = await fetchText(`${SPA_BASE}/referenceRatesPage/all?language=pt-br`, 'text/html')
  const assets: string[] = []
  if (spa.text) {
    for (const mm of spa.text.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/gi)) {
      let a = mm[1]
      if (a.startsWith('//')) a = 'https:' + a
      else if (a.startsWith('/')) a = SPA_BASE + a
      else if (!a.startsWith('http')) a = `${SPA_BASE}/referenceRatesPage/` + a
      if (!assets.includes(a) && !a.includes('ruxitagent')) assets.push(a)
    }
  }

  // 2. Varre os bundles atrás dos CALL-SITES de GetList/GetDate: as janelas
  //    mostram o objeto de parâmetros sendo montado antes do btoa(JSON).
  const windows: string[] = []
  for (const jsUrl of assets.slice(0, 4)) {
    const { text: js } = await fetchText(jsUrl, '*/*')
    if (!js) continue
    const needle = /getList\(|GetList|getDate\(|GetDate|selectedProduct/g
    let m: RegExpExecArray | null
    while ((m = needle.exec(js)) && windows.length < 14) {
      windows.push(js.slice(Math.max(0, m.index - 380), m.index + 420).replace(/\s+/g, ' '))
      needle.lastIndex = m.index + 400 // pula janelas sobrepostas
    }
    if (windows.length >= 14) break
  }

  // 3. Tentativas diretas: payloads prováveis no padrão b64(JSON) das SPAs da B3.
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64')
  const candidates = [
    `${PROXY_BASE}Search/GetDate/${b64({ language: 'pt-br' })}`,
    `${PROXY_BASE}Search/GetList/${b64({ language: 'pt-br', date })}`,
    `${PROXY_BASE}Search/GetList/${b64({ language: 'pt-br', date: br })}`,
    `${PROXY_BASE}Search/GetList/${b64({ language: 'pt-br', date, product: 'PRE' })}`,
    `${PROXY_BASE}Search/GetList/${b64({ language: 'pt-br', dateSelected: date, product: 'PRE' })}`,
  ]
  const calls: CallProbe[] = []
  for (const c of candidates) {
    calls.push(await probeCall(c))
  }

  const result = {
    v: 3,
    ranAt: new Date().toISOString(),
    date,
    region: process.env.VERCEL_REGION ?? null,
    spaStatus: spa.res?.status ?? null,
    assets,
    windows,
    calls,
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
