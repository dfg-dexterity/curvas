/**
 * Calendário de dias úteis brasileiro (feriados nacionais bancários — o mesmo
 * conjunto do calendário ANBIMA usado pelo Manual de Curvas da B3, item 1.2:
 * "A construção de dias úteis é feita a partir do calendário de feriados
 * divulgado pela ANBIMA").
 *
 * Feriados fixos: 01/01, 21/04, 01/05, 07/09, 12/10, 02/11, 15/11, 25/12 e
 * 20/11 (Consciência Negra, feriado nacional a partir de 2024 — Lei 14.759).
 * Feriados móveis (derivados da Páscoa): segunda e terça de Carnaval,
 * Sexta-feira Santa e Corpus Christi.
 */

/** Domingo de Páscoa (algoritmo gregoriano anônimo/Meeus) em UTC. */
export function easterSunday(year: number): Date {
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
  const month = Math.floor((h + l - 7 * m + 114) / 31) // 3 = março, 4 = abril
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

const holidayCache = new Map<number, Set<string>>()

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDaysUTC(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000)
}

/** Conjunto de feriados nacionais (ISO) do ano, memoizado. */
export function nationalHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year)
  if (cached) return cached

  const set = new Set<string>()
  const fixed: Array<[number, number]> = [
    [1, 1], // Confraternização Universal
    [4, 21], // Tiradentes
    [5, 1], // Dia do Trabalho
    [9, 7], // Independência
    [10, 12], // Nossa Senhora Aparecida
    [11, 2], // Finados
    [11, 15], // Proclamação da República
    [12, 25], // Natal
  ]
  if (year >= 2024) fixed.push([11, 20]) // Consciência Negra (Lei 14.759/2023)
  for (const [month, day] of fixed) set.add(iso(new Date(Date.UTC(year, month - 1, day))))

  const easter = easterSunday(year)
  set.add(iso(addDaysUTC(easter, -48))) // segunda de Carnaval
  set.add(iso(addDaysUTC(easter, -47))) // terça de Carnaval
  set.add(iso(addDaysUTC(easter, -2))) // Sexta-feira Santa
  set.add(iso(addDaysUTC(easter, 60))) // Corpus Christi

  holidayCache.set(year, set)
  return set
}

export function isHolidayBR(date: Date): boolean {
  return nationalHolidays(date.getUTCFullYear()).has(iso(date))
}

export function isBusinessDayBR(date: Date): boolean {
  const weekday = date.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  return !isHolidayBR(date)
}

function toUTC(dateISO: string): Date {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/**
 * Dias úteis entre a data-base (exclusiva) e a data-base + dias corridos
 * (inclusiva) — a contagem DU do par (DC, DU) dos vértices padronizados da B3.
 */
export function businessDaysForCalendarDays(baseDateISO: string, calendarDays: number): number {
  const base = toUTC(baseDateISO)
  let count = 0
  for (let offset = 1; offset <= calendarDays; offset++) {
    if (isBusinessDayBR(addDaysUTC(base, offset))) count++
  }
  return count
}
