import { describe, expect, it } from 'vitest'
import {
  addDays,
  businessDaysBetween,
  isBusinessDay,
  isValidISODate,
  lastBusinessDays,
  previousBusinessDay,
} from '../dates'

describe('isValidISODate', () => {
  it('valida formato e calendário', () => {
    expect(isValidISODate('2024-01-15')).toBe(true)
    expect(isValidISODate('2024-02-30')).toBe(false)
    expect(isValidISODate('2024-13-01')).toBe(false)
    expect(isValidISODate('15/01/2024')).toBe(false)
  })
})

describe('isBusinessDay (calendário B3)', () => {
  it('exclui fins de semana', () => {
    expect(isBusinessDay('2024-07-13')).toBe(false) // sábado
    expect(isBusinessDay('2024-07-14')).toBe(false) // domingo
    expect(isBusinessDay('2024-07-15')).toBe(true) // segunda
  })

  it('exclui feriados móveis de 2024 (Páscoa em 31/03)', () => {
    expect(isBusinessDay('2024-02-12')).toBe(false) // segunda de Carnaval
    expect(isBusinessDay('2024-02-13')).toBe(false) // terça de Carnaval
    expect(isBusinessDay('2024-02-14')).toBe(true) // quarta de cinzas: há pregão
    expect(isBusinessDay('2024-03-29')).toBe(false) // Sexta-feira Santa
    expect(isBusinessDay('2024-05-30')).toBe(false) // Corpus Christi
  })

  it('inclui Consciência Negra apenas a partir de 2024', () => {
    expect(isBusinessDay('2024-11-20')).toBe(false)
    expect(isBusinessDay('2023-11-20')).toBe(true) // segunda-feira comum em 2023
  })

  it('exclui vésperas sem pregão (24 e 31/12)', () => {
    expect(isBusinessDay('2024-12-24')).toBe(false)
    expect(isBusinessDay('2024-12-26')).toBe(true)
    expect(isBusinessDay('2024-12-31')).toBe(false)
  })
})

describe('navegação por dias úteis', () => {
  it('previousBusinessDay salta Carnaval e fim de semana', () => {
    expect(previousBusinessDay('2024-02-14')).toBe('2024-02-09')
  })

  it('lastBusinessDays devolve em ordem ascendente', () => {
    expect(lastBusinessDays(3, '2024-02-14')).toEqual(['2024-02-08', '2024-02-09', '2024-02-14'])
  })

  it('lastBusinessDays com fim em dia não-útil recua primeiro', () => {
    expect(lastBusinessDays(2, '2024-07-14')).toEqual(['2024-07-11', '2024-07-12'])
  })

  it('businessDaysBetween filtra o intervalo fechado', () => {
    expect(businessDaysBetween('2024-02-09', '2024-02-14')).toEqual(['2024-02-09', '2024-02-14'])
  })

  it('addDays cruza meses/anos', () => {
    expect(addDays('2024-01-01', -1)).toBe('2023-12-31')
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01') // bissexto
  })
})
