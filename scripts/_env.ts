import path from 'node:path'

// Efeito colateral na importação: garante que o .env esteja carregado ANTES
// dos módulos que leem process.env (importe './_env' como primeiro import).
try {
  process.loadEnvFile(path.join(process.cwd(), '.env'))
} catch {
  // sem .env: usa as variáveis já presentes no ambiente
}
