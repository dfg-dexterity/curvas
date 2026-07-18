import './_env'
import fs from 'node:fs'
import { buildRatesUrl, fetchRatesPageHtml } from '../src/lib/b3/client'
import { parseRatesPage } from '../src/lib/b3/parse'
import { isValidISODate, latestExpectedDataDate } from '../src/lib/dates'

/**
 * Diagnóstico da comunicação com a B3 — NÃO grava nada no banco.
 * Mostra o que o parser entendeu da página: taxas do dropdown, colunas
 * detectadas e primeiros vértices. Útil para verificar o ambiente e para
 * investigar mudanças de estrutura na página.
 *
 * Uso: npm run probe -- [--date=AAAA-MM-DD] [--rate=PRE] [--save=pagina.html]
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

  console.log(`URL: ${buildRatesUrl(date, rate)}\n`)
  const html = await fetchRatesPageHtml(date, rate)
  console.log(`HTML recebido: ${html.length} caracteres`)
  if (save) {
    fs.writeFileSync(save, html)
    console.log(`Página salva em ${save}`)
  }

  const parsed = parseRatesPage(html)
  console.log(`\nTaxas no dropdown (${parsed.options.length}):`)
  for (const opt of parsed.options) console.log(`  ${opt.code.padEnd(6)} ${opt.name}`)

  console.log(
    `\nColunas detectadas: 252=${parsed.columns.has252} 360=${parsed.columns.has360}` +
      ` | vértices: ${parsed.rows.length}`,
  )
  if (parsed.emptyReason) console.log(`Mensagem de vazio: ${parsed.emptyReason}`)
  if (parsed.warnings.length) console.log(`Avisos: ${parsed.warnings.join(' | ')}`)

  console.log('\nPrimeiros vértices:')
  for (const row of parsed.rows.slice(0, 5)) {
    console.log(`  ${String(row.days).padStart(6)} dias | 252: ${row.rate252 ?? '—'} | 360: ${row.rate360 ?? '—'}`)
  }
}

main().catch((err) => {
  console.error('Falha na consulta:', err)
  process.exit(1)
})
