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
      className="sticky top-0 z-20 border-b backdrop-blur"
      style={{
        borderColor: 'var(--rule)',
        background: 'color-mix(in srgb, var(--paper) 88%, transparent)',
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
              className="rounded-[3px] px-2.5 py-1 text-sm transition-colors"
              style={
                ativo
                  ? { background: 'var(--cerceta)', color: '#fff', fontWeight: 600 }
                  : { color: 'var(--ink-soft)', fontWeight: 500 }
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
