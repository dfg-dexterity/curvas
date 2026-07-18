import path from 'node:path'
import { defineConfig } from 'prisma/config'

// O CLI do Prisma 7 não carrega .env automaticamente.
try {
  process.loadEnvFile(path.join(import.meta.dirname, '.env'))
} catch {
  // sem .env (ex.: CI/Vercel, onde as variáveis já vêm do ambiente)
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  // Usada pelo CLI (migrate/db push). O runtime usa o adapter em src/lib/db.ts.
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/curvas',
  },
})
