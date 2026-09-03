/**
 * Marca Dexterity: cata-vento de quatro pétalas, a primeira em cerceta.
 * Herda o tamanho de quem usa (width/height via className ou style).
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true">
      <path d="M50 50 C50 22 68 2 98 2 C98 32 78 50 50 50 Z" fill="var(--cerceta)" />
      <path d="M50 50 C78 50 98 68 98 98 C68 98 50 78 50 50 Z" fill="var(--grafite)" />
      <path d="M50 50 C50 78 32 98 2 98 C2 68 22 50 50 50 Z" fill="var(--grafite)" />
      <path d="M50 50 C22 50 2 32 2 2 C32 2 50 22 50 50 Z" fill="var(--grafite)" />
    </svg>
  )
}
