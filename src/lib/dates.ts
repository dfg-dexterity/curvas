const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isValidISODate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

export function toUTCDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`)
}

export function toISO(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(iso: string, delta: number): string {
  const date = toUTCDate(iso)
  date.setUTCDate(date.getUTCDate() + delta)
  return toISO(date)
}

export function formatBr(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/** Data corrente no fuso de São Paulo (referência do pregão da B3). */
export function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

const holidayCache = new Map<number, Set<string>>()

/**
 * Feriados em que a B3 não opera: nacionais fixos, móveis (Carnaval, Paixão,
 * Corpus Christi) e as vésperas de Natal/Ano-Novo (sem pregão).
 * Consciência Negra (20/11) é feriado nacional desde 2024.
 */
export function b3Holidays(year: number): Set<string> {
  const cached = holidayCache.get(year)
  if (cached) return cached

  const set = new Set<string>()
  const fixed = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-24', '12-25', '12-31']
  if (year >= 2024) fixed.push('11-20')
  for (const md of fixed) set.add(`${year}-${md}`)

  const easter = easterSunday(year)
  const offsets = [-48, -47, -2, 60] // seg/ter de Carnaval, Sexta-feira Santa, Corpus Christi
  for (const offset of offsets) {
    const date = new Date(easter)
    date.setUTCDate(date.getUTCDate() + offset)
    set.add(toISO(date))
  }

  holidayCache.set(year, set)
  return set
}

export function isBusinessDay(iso: string): boolean {
  const date = toUTCDate(iso)
  const weekday = date.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  return !b3Holidays(date.getUTCFullYear()).has(iso)
}

export function previousBusinessDay(iso: string): string {
  let current = addDays(iso, -1)
  while (!isBusinessDay(current)) current = addDays(current, -1)
  return current
}

/**
 * Última data cujo pregão já deve ter taxas publicadas: hoje (São Paulo) se
 * for dia útil, senão o dia útil anterior. A publicação ocorre no fim do dia;
 * tentativas cedo demais registram EMPTY e são reprocessadas pelo job.
 */
export function latestExpectedDataDate(): string {
  const today = todayInSaoPaulo()
  return isBusinessDay(today) ? today : previousBusinessDay(today)
}

/** Os últimos `n` dias úteis terminando em `endISO` (inclusive), ascendente. */
export function lastBusinessDays(n: number, endISO: string): string[] {
  const days: string[] = []
  let current = isBusinessDay(endISO) ? endISO : previousBusinessDay(endISO)
  while (days.length < n) {
    days.push(current)
    current = previousBusinessDay(current)
  }
  return days.reverse()
}

/** Dias úteis no intervalo [fromISO, toISO], ascendente. */
export function businessDaysBetween(fromISO: string, toISO: string): string[] {
  const days: string[] = []
  let current = fromISO
  while (current <= toISO) {
    if (isBusinessDay(current)) days.push(current)
    current = addDays(current, 1)
  }
  return days
}
