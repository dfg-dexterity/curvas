import { B3FetchError } from './types'

const DEFAULT_URL =
  'https://www2.bmf.com.br/pages/portal/bmfbovespa/lumis/lum-taxas-referenciais-bmf-ptBR.asp'

// A B3 rejeita user-agents genéricos; simulamos um navegador comum.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const TIMEOUT_MS = 25_000
const MAX_ATTEMPTS = 3

export function b3BaseUrl(): string {
  return process.env.B3_TR_URL || DEFAULT_URL
}

/** Monta a URL da consulta: Data=DD/MM/AAAA, Data1=AAAAMMDD, slcTaxa=CODIGO. */
export function buildRatesUrl(dateISO: string, rateCode?: string): string {
  const [y, m, d] = dateISO.split('-')
  const params = new URLSearchParams()
  params.set('Data', `${d}/${m}/${y}`)
  params.set('Data1', `${y}${m}${d}`)
  if (rateCode) params.set('slcTaxa', rateCode)
  return `${b3BaseUrl()}?${params.toString()}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Decodifica o corpo respeitando o charset (as páginas antigas usam latin1). */
function decodeBody(buf: ArrayBuffer, contentType: string | null): string {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1]
  if (!charset) {
    const head = new TextDecoder('latin1').decode(buf.slice(0, 2048))
    charset = /charset=["']?([\w-]+)/i.exec(head)?.[1] ?? 'iso-8859-1'
  }
  try {
    return new TextDecoder(charset).decode(buf)
  } catch {
    return new TextDecoder('iso-8859-1').decode(buf)
  }
}

/**
 * Baixa o HTML da página de Taxas Referenciais para uma data (e taxa) com
 * retry exponencial. Erros 4xx (exceto 429) não são repetidos.
 */
export async function fetchRatesPageHtml(dateISO: string, rateCode?: string): Promise<string> {
  const url = buildRatesUrl(dateISO, rateCode)
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-BR,pt;q=0.9',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      })

      if (!res.ok) {
        const retryable = res.status >= 500 || res.status === 429
        const err = new B3FetchError(`B3 respondeu HTTP ${res.status} para ${url}`, res.status)
        if (!retryable) throw err
        lastError = err
      } else {
        const buf = await res.arrayBuffer()
        return decodeBody(buf, res.headers.get('content-type'))
      }
    } catch (err) {
      if (err instanceof B3FetchError && err.status && err.status < 500 && err.status !== 429) {
        throw err
      }
      lastError = err
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(800 * 2 ** (attempt - 1) + Math.random() * 400)
    }
  }

  if (lastError instanceof Error) {
    throw new B3FetchError(`Falha ao consultar a B3 após ${MAX_ATTEMPTS} tentativas: ${lastError.message}`)
  }
  throw new B3FetchError(`Falha ao consultar a B3 após ${MAX_ATTEMPTS} tentativas`)
}
