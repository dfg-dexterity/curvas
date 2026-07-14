import { NextResponse } from 'next/server'
import { isValidISODate, latestExpectedDataDate } from './dates'

export const RATE_CODE_RE = /^[A-Z]{2,6}$/
export const MIN_DATE = '1995-01-01'

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 })
}

export function parseRateCode(raw: string | null): string | null {
  const code = raw?.trim().toUpperCase() ?? ''
  return RATE_CODE_RE.test(code) ? code : null
}

/** Valida uma data ISO dentro do intervalo consultável (passado até hoje). */
export function parseDateParam(raw: string | null): string | null {
  const value = raw?.trim() ?? ''
  if (!isValidISODate(value)) return null
  if (value < MIN_DATE || value > latestExpectedDataDate()) return null
  return value
}
