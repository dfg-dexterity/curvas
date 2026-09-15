import type { Metadata, Viewport } from 'next'
import { Barlow_Condensed, Figtree, IBM_Plex_Mono } from 'next/font/google'
import { SiteNav } from '../components/SiteNav'
import './globals.css'

/* Fontes da marca Dexterity: condensada nos títulos, humanista no corpo. */
const figtree = Figtree({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
})

/* Mono da marca: rótulos, sobrancelhas e números que se comparam. */
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Curvas B3 — Taxas Referenciais',
  description:
    'Curvas de juros das Taxas Referenciais da B3 (DI x pré, cupom cambial, IPCA e todas as demais), com histórico diário, consulta retroativa, marcação a mercado, correção CDI e simulação de empréstimos.',
}

export const viewport: Viewport = {
  themeColor: '#1B1B1B',
}

/* Tema escuro único — daí a classe `dark` fixa no <html>. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`dark ${figtree.variable} ${barlowCondensed.variable} ${ibmPlexMono.variable}`}
    >
      <body className="min-h-screen antialiased">
        <SiteNav />
        {children}
      </body>
    </html>
  )
}
