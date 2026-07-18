import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'

const globalForPrisma = globalThis as unknown as { prismaClient?: PrismaClient }

function getClient(): PrismaClient {
  if (globalForPrisma.prismaClient) return globalForPrisma.prismaClient
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL não definida. Copie .env.example para .env e configure o Postgres.')
  }
  // Pool pequeno: funciona bem em serverless e com o pooler do Supabase.
  const adapter = new PrismaPg({ connectionString, max: 5 })
  const client = new PrismaClient({ adapter })
  globalForPrisma.prismaClient = client
  return client
}

/**
 * Client preguiçoso: só instancia (e exige DATABASE_URL) no primeiro uso real,
 * nunca quando o módulo é importado — o `next build` importa as rotas sem
 * precisar de banco. A instância é cacheada em globalThis (sobrevive ao HMR
 * em dev e é reutilizada por invocações serverless na mesma instância).
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient()
    const value = Reflect.get(client, prop)
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(client) : value
  },
})
