import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Curvas B3 — Taxas Referenciais',
  description:
    'Curvas de juros das Taxas Referenciais da B3 (DI x pré, cupom cambial, IPCA e todas as demais), com histórico diário e consulta retroativa.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
