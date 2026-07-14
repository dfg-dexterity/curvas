import './_env'
import { runDailyJob } from '../src/lib/ingest'

/**
 * Executa o job diário fora do Vercel (systemd timer, cron do SO, GitHub
 * Actions…). Uso: npm run job:daily
 */
async function main() {
  console.log('Iniciando job diário de ingestão das taxas da B3…')
  const result = await runDailyJob()

  console.log(`\nDescoberta de taxas: ${result.discovery.ok ? 'ok' : 'falhou'}`, result.discovery)
  console.log(`Datas-alvo: ${result.targetDates.join(', ')}`)
  console.log(
    `Resultado: ${result.ok} ok, ${result.empty} sem dados, ${result.error} erros, ` +
      `${result.skipped} já capturadas (${result.attempted} consultas em ${Math.round(result.durationMs / 1000)}s)`,
  )
  if (result.errors.length > 0) {
    console.error('\nErros:')
    for (const err of result.errors) console.error(`  ${err.rateCode} ${err.date}: ${err.message}`)
    process.exitCode = 1
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => process.exit())
