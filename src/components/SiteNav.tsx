'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

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
      style={{ borderColor: 'var(--grid, #e7eaf1)', background: 'color-mix(in srgb, var(--surface, #fff) 88%, transparent)' }}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 py-2 sm:px-6">
        <span
          aria-hidden
          className="mr-2 grid h-6 w-6 place-items-center rounded-md text-xs font-bold text-white"
          style={{ background: 'var(--accent)' }}
        >
          %
        </span>
        {LINKS.map((link) => {
          const ativo = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href)
          return (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-2.5 py-1 text-sm font-medium hover:opacity-80"
              style={
                ativo
                  ? { background: 'var(--accent)', color: '#fff' }
                  : { color: 'var(--ink-2)' }
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
