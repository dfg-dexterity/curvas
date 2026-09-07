import './_env'
import fs from 'node:fs'
import { buildSearchUrl, fetchAvailableDates, fetchProducts, fetchRatesPage } from '../src/lib/b3/client'
import { isValidISODate, latestExpectedDataDate } from '../src/lib/dates'

/**
 * Diagnóstico da comunicação com a B3 — NÃO grava nada no banco.
 * Consulta a API moderna (referenceRatesProxy) e mostra o que o cliente
 * entendeu: produtos, datas publicadas e primeiros vértices da curva.
 *
 * Uso: npm run probe -- [--date=AAAA-MM-DD] [--rate=PRE] [--save=curva.json]
 */
function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length)
}

async function main() {
  const date = arg('date') ?? latestExpectedDataDate()
  const rate = (arg('rate') ?? 'PRE').toUpperCase()
  const save = arg('save')

  if (!isValidISODate(date)) {
    console.error('Data inválida. Use --date=AAAA-MM-DD')
    process.exit(1)
  }

  console.log(
    `GetList: ${buildSearchUrl('GetList', { language: 'pt-br', id: rate, date, pageNumber: 1, pageSize: 120 })}\n`,
  )

  const products = await fetchProducts()
  console.log(`Produtos (${products.length}): ${products.map((p) => p.code).join(', ') || '(vazio)'}`)

  const dates = await fetchAvailableDates(rate)
  console.log(
    `Datas publicadas p/ ${rate} (${dates.length}): ${dates.slice(0, 5).join(', ')}${dates.length > 5 ? '…' : ''}`,
  )

  const page = await fetchRatesPage(rate, date)
  console.log(`\nCurva ${rate} em ${date}: ${page.rows.length} vértices`)
  console.log(`Colunas detectadas: 252=${page.columns.has252} 360=${page.columns.has360}`)
  if (page.emptyReason) console.log(`Mensagem de vazio: ${page.emptyReason}`)
  if (page.warnings.length) console.log(`Avisos: ${page.warnings.join(' | ')}`)

  console.log('\nPrimeiros vértices:')
  for (const row of page.rows.slice(0, 8)) {
    console.log(`  ${String(row.days).padStart(6)} dias | 252: ${row.rate252 ?? '—'} | 360: ${row.rate360 ?? '—'}`)
  }
  if (page.rows.length > 8) console.log(`  … +${page.rows.length - 8} vértices`)

  if (save) {
    fs.writeFileSync(save, JSON.stringify(page, null, 2))
    console.log(`\nResultado salvo em ${save}`)
  }
}

main().catch((err) => {
  console.error('Falha na consulta:', err instanceof Error ? `${err.name}: ${err.message}` : err)
  process.exit(1)
})
