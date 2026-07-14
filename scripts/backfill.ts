import './_env'
import { backfillRange } from '../src/lib/ingest'
import { businessDaysBetween, isValidISODate, latestExpectedDataDate } from '../src/lib/dates'

/**
 * Preenche o histórico de curvas em um intervalo de datas.
 *
 * Uso:
 *   npm run job:backfill -- --from=2024-01-01 [--to=2024-06-30] [--rates=PRE,DIC] [--concurrency=4]
 *
 * Reexecutável: pares (taxa, data) já capturados são pulados automaticamente,
 * então dá para interromper com Ctrl+C e retomar depois.
 */
function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length)
}

async function main() {
  const from = arg('from')
  const to = arg('to') ?? latestExpectedDataDate()
  const rates = arg('rates')
    ?.split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
  const concurrency = Number.parseInt(arg('concurrency') ?? '', 10) || undefined

  if (!from || !isValidISODate(from) || !isValidISODate(to) || from > to) {
    console.error('Uso: npm run job:backfill -- --from=AAAA-MM-DD [--to=AAAA-MM-DD] [--rates=PRE,DIC] [--concurrency=4]')
    process.exit(1)
  }

  const nDates = businessDaysBetween(from, to).length
  console.log(
    `Backfill de ${from} a ${to}: ${nDates} dias úteis` +
      (rates?.length ? `, taxas ${rates.join(', ')}` : ', todas as taxas ativas') +
      '. Pares já capturados serão pulados.\n',
  )

  const totals = await backfillRange({
    from,
    to,
    rateCodes: rates,
    concurrency,
    onDateDone: (p) => {
      console.log(
        `${p.date}: ${p.ok} ok, ${p.empty} sem dados, ${p.error} erros, ${p.skipped} puladas`,
      )
    },
  })

  console.log(
    `\nConcluído: ${totals.ok} curvas gravadas, ${totals.empty} sem dados, ` +
      `${totals.error} erros, ${totals.skipped} puladas em ${totals.dates} dias úteis.`,
  )
  if (totals.error > 0) {
    console.log('Reexecute o mesmo comando para tentar novamente apenas o que falhou.')
    process.exitCode = 1
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => process.exit())
