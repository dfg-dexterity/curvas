'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BrandMark } from './BrandMark'

const LINKS = [
  { href: '/', label: 'Curvas' },
  { href: '/mtm', label: 'Marcação a mercado' },
  { href: '/cdi', label: 'Correção CDI' },
  { href: '/emprestimos', label: 'Empréstimos' },
]

/** Navegação entre os módulos do app (curvas, MtM, CDI, empréstimos). */
export function SiteNav() {
  const pathname = usePathname()
  return (
    <nav
      aria-label="Módulos"
      className="sticky top-0 z-20 border-b backdrop-blur-[14px]"
      style={{
        borderColor: 'var(--rule)',
        background: 'rgba(27, 27, 27, 0.82)',
      }}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-1 gap-y-2 px-4 py-2.5 sm:px-6">
        <Link href="/" className="mr-4 flex items-center gap-2.5" aria-label="Início">
          <BrandMark className="h-6 w-6 flex-none" />
          <span className="dex-display text-xl">
            Curvas <span style={{ color: 'var(--ink-soft)' }}>Dexterity</span>
          </span>
        </Link>
        {LINKS.map((link) => {
          const ativo = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href)
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={ativo ? 'page' : undefined}
              className="px-2.5 py-1 text-sm tracking-[0.01em] transition-colors"
              style={
                ativo
                  ? { color: 'var(--cerceta-fundo)', fontWeight: 500 }
                  : { color: 'var(--ink-soft)', fontWeight: 300 }
              }
            >
              {link.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
