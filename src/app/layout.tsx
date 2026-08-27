import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { SiteNav } from '../components/SiteNav'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Curvas B3 — Taxas Referenciais',
  description:
    'Curvas de juros das Taxas Referenciais da B3 (DI x pré, cupom cambial, IPCA e todas as demais), com histórico diário, consulta retroativa, marcação a mercado, correção CDI e simulação de empréstimos.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="min-h-screen antialiased">
        <SiteNav />
        {children}
      </body>
    </html>
  )
}
