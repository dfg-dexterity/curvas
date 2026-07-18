import * as cheerio from 'cheerio'
import type { CheerioAPI } from 'cheerio'
import type { AnyNode } from 'domhandler'
import { B3ParseError, type CurveRow, type ParsedRatesPage, type RateOption } from './types'

function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** "1.234" -> 1234; retorna null se a célula não for um inteiro. */
export function parseIntBr(raw: string): number | null {
  const s = normalizeSpace(raw)
  if (!/^\d[\d.]*$/.test(s)) return null
  const n = Number.parseInt(s.replace(/\./g, ''), 10)
  return Number.isFinite(n) ? n : null
}

/** "1.234,5678" -> 1234.5678; "-0,52" -> -0.52; vazio/"-"/"--" -> null. */
export function parseRateBr(raw: string): number | null {
  const s = normalizeSpace(raw).replace(/ /g, '')
  if (!s || /^-+$/.test(s) || s.toLowerCase() === 'n/d') return null
  if (!/^-?[\d.,]+$/.test(s)) return null
  const n = Number.parseFloat(s.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const EMPTY_PATTERNS = [
  /n[ãa]o\s+h[áa]\s+dados/i,
  /n[ãa]o\s+existem\s+dados/i,
  /n[ãa]o\s+h[áa]\s+informa[çc][õo]es/i,
  /no\s+data\s+(?:available|found)/i,
]

function findEmptyReason(pageText: string): string | undefined {
  for (const pattern of EMPTY_PATTERNS) {
    const match = pattern.exec(pageText)
    if (match) return normalizeSpace(match[0])
  }
  return undefined
}

/**
 * Localiza o dropdown de taxas (slcTaxa) e extrai todas as opções.
 * Se o seletor conhecido não existir, procura qualquer <select> cujas opções
 * pareçam códigos de taxa (2–6 letras maiúsculas).
 */
export function parseRateOptions($: CheerioAPI): RateOption[] {
  let select = $('select[name="slcTaxa"], select#slcTaxa').first()

  if (select.length === 0) {
    select = $('select')
      .filter((_, el) => {
        const codeLike = $(el)
          .find('option')
          .filter((_, opt) => /^[A-Z]{2,6}$/.test(($(opt).attr('value') ?? '').trim()))
        return codeLike.length >= 3
      })
      .first()
  }

  const options: RateOption[] = []
  const seen = new Set<string>()
  select.find('option').each((_, opt) => {
    const code = ($(opt).attr('value') ?? '').trim().toUpperCase()
    const name = normalizeSpace($(opt).text())
    if (!/^[A-Z]{2,6}$/.test(code) || seen.has(code)) return
    seen.add(code)
    options.push({ code, name: name || code })
  })
  return options
}

interface TableParse {
  rows: CurveRow[]
  columns: { has252: boolean; has360: boolean }
  warnings: string[]
}

/**
 * Encontra a tabela de vértices (a que menciona "Dias Corridos") e interpreta
 * o cabeçalho para saber quais bases (252/360) esta curva publica. O layout da
 * B3 usa tabelas aninhadas, então escolhemos a candidata com mais linhas de
 * dados (primeira célula inteira).
 */
export function parseCurveTable($: CheerioAPI): TableParse {
  const warnings: string[] = []

  let bestEl: AnyNode | null = null
  let bestDataRows = -1

  $('table').each((_, table) => {
    const $table = $(table)
    const text = normalizeSpace($table.text()).toLowerCase()
    if (!/dias\s+corridos/.test(text)) return

    let dataRows = 0
    $table.find('tr').each((_, tr) => {
      const first = $(tr).find('td, th').first()
      if (first.length && parseIntBr(first.text()) !== null) dataRows++
    })
    // Preferimos a tabela mais interna: com o mesmo número de linhas de dados,
    // uma tabela aninhada aparece DEPOIS no documento e a substitui aqui.
    if (dataRows >= bestDataRows) {
      bestDataRows = dataRows
      bestEl = table
    }
  })

  if (!bestEl) {
    return { rows: [], columns: { has252: false, has360: false }, warnings }
  }

  const trRows = $(bestEl)
    .find('tr')
    .toArray()
    .map((tr) =>
      $(tr)
        .find('td, th')
        .toArray()
        .map((cell) => normalizeSpace($(cell).text())),
    )
    .filter((cells) => cells.length > 0)

  // Uma linha só com marcadores "252"/"360" é o subcabeçalho do layout com
  // rowspan ("Dias Corridos" ocupa duas linhas) — nunca uma linha de dados.
  const isBaseMarkerRow = (cells: string[]) => cells.every((c) => c === '252' || c === '360')
  const isDataRow = (cells: string[]) => parseIntBr(cells[0]) !== null && !isBaseMarkerRow(cells)

  // 1ª passada: ordem das colunas de base, lida apenas das linhas de cabeçalho
  // que aparecem ANTES da primeira linha de dados (evita notas de rodapé).
  const order: Array<'rate252' | 'rate360'> = []
  for (const cells of trRows) {
    if (isDataRow(cells)) break
    const text = cells.join(' ')
    for (const match of text.matchAll(/(?:^|\D)(252|360)(?=\D|$)/g)) {
      const key = match[1] === '252' ? 'rate252' : 'rate360'
      if (!order.includes(key)) order.push(key)
    }
  }

  if (order.length === 0) {
    // Cabeçalho fora do padrão: assume base 252 (a mais comum) e avisa.
    order.push('rate252')
    warnings.push('Cabeçalho sem marcador 252/360; valores atribuídos à base 252.')
  }

  // 2ª passada: linhas de dados, valores atribuídos na ordem do cabeçalho.
  const byDays = new Map<number, CurveRow>()
  for (const cells of trRows) {
    if (!isDataRow(cells)) continue
    const days = parseIntBr(cells[0]) as number
    const values = cells.slice(1).map(parseRateBr)

    if (byDays.has(days)) {
      warnings.push(`Prazo duplicado na tabela: ${days} dias; mantida a primeira ocorrência.`)
      continue
    }

    const row: CurveRow = { days, rate252: null, rate360: null }
    order.forEach((base, i) => {
      row[base] = values[i] ?? null
    })
    byDays.set(days, row)
  }

  return {
    rows: [...byDays.values()].sort((a, b) => a.days - b.days),
    columns: { has252: order.includes('rate252'), has360: order.includes('rate360') },
    warnings,
  }
}

/**
 * Resumo compacto do HTML para diagnosticar POR QUE a página não foi
 * reconhecida. Vai anexado à mensagem do B3ParseError e, por consequência, é
 * persistido em FetchLog.message — então o log de produção passa a distinguir
 * as causas prováveis sem precisar de acesso à B3: um shell anti-bot moderno
 * (foundation/dynatrace, sem tabela), um desafio Cloudflare (challenge=1), a
 * tabela movida para um iframe (iframes>0) ou uma mudança de estrutura.
 */
function pageDiagnostics(html: string, $: CheerioAPI): string {
  const low = html.toLowerCase()
  const title = normalizeSpace($('title').first().text()).slice(0, 80)
  const challenge =
    low.includes('just a moment') ||
    low.includes('cf-mitigated') ||
    low.includes('attention required') ||
    low.includes('enable javascript and cookies')
  const marks =
    `len=${html.length} tables=${$('table').length} iframes=${$('iframe').length} ` +
    `selects=${$('select').length} challenge=${challenge ? 1 : 0} ` +
    `foundation=${low.includes('foundation') ? 1 : 0} ` +
    `dynatrace=${low.includes('ruxitagentjs') || low.includes('dynatrace') ? 1 : 0}`
  const iframeSrc = $('iframe').first().attr('src')
  const extra = iframeSrc ? ` iframeSrc=${iframeSrc.slice(0, 120)}` : ''
  return `diag[${marks}]${extra} title="${title}"`
}

/**
 * Interpreta a página completa. Lança B3ParseError quando o HTML não se parece
 * com a página de taxas (nem dropdown, nem tabela, nem mensagem de vazio) —
 * típico de bloqueio/erro do servidor — para que a captura seja repetida em vez
 * de registrada como "sem dados".
 */
export function parseRatesPage(html: string): ParsedRatesPage {
  const $ = cheerio.load(html)
  const options = parseRateOptions($)
  const { rows, columns, warnings } = parseCurveTable($)
  const emptyReason = findEmptyReason(normalizeSpace($('body').text() || html))

  if (options.length === 0 && rows.length === 0 && !emptyReason) {
    throw new B3ParseError(
      'Página da B3 não reconhecida (sem dropdown de taxas, sem tabela e sem mensagem de vazio). ' +
        pageDiagnostics(html, $),
    )
  }

  return { options, rows, columns, emptyReason, warnings }
}
