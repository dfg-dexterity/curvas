/**
 * Cliente da API pública SGS do Banco Central (server-side, sem CORS):
 *  - 4389: DI/CDI anualizado base 252 (% a.a.), diária
 *  - 1178: Selic anualizada base 252 (% a.a.), diária
 *  - 1:    Dólar americano venda (PTAX), diária
 * A API limita cada consulta a ~10 anos; as janelas são fatiadas em 8 anos.
 */

import { addDays } from './dates'
import type { PontoCDI } from './financas/cdi'

export const SGS_CDI = 4389
export const SGS_SELIC = 1178
export const SGS_PTAX_VENDA = 1

interface SGSItem {
  data: string // DD/MM/AAAA
  valor: string
}

function brToISO(dataBR: string): string {
  const [d, m, y] = dataBR.split('/')
  return `${y}-${m}-${d}`
}

function isoToBR(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export async function fetchSGS(
  serie: number,
  fromISO: string,
  toISO: string,
): Promise<PontoCDI[]> {
  const out: PontoCDI[] = []
  let ini = fromISO
  while (ini <= toISO) {
    const fimJanela = addDays(ini, 365 * 8)
    const fim = fimJanela < toISO ? fimJanela : toISO
    const url =
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados?formato=json` +
      `&dataInicial=${isoToBR(ini)}&dataFinal=${isoToBR(fim)}`
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(25_000),
    })
    if (!res.ok) throw new Error(`BCB SGS ${serie}: HTTP ${res.status}`)
    const body = (await res.json()) as SGSItem[]
    if (Array.isArray(body)) {
      for (const item of body) {
        out.push({ date: brToISO(item.data), rate: Number(String(item.valor).replace(',', '.')) })
      }
    }
    ini = addDays(fim, 1)
  }
  return out
}

/** Última cotação PTAX venda disponível ≤ data (procura até 10 dias atrás). */
export async function fetchPTAXAte(dateISO: string): Promise<{ date: string; valor: number } | null> {
  const serie = await fetchSGS(SGS_PTAX_VENDA, addDays(dateISO, -10), dateISO)
  if (serie.length === 0) return null
  const ultimo = serie[serie.length - 1]
  return { date: ultimo.date, valor: ultimo.rate }
}
