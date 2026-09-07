/**
 * Helper server-side: carrega uma curva do banco (com retro-busca na B3 sob
 * demanda) e devolve o interpolador do Manual de Curvas pronto para uso.
 */

import { buildInterpolator, type CurveInterpolator } from '../curves/interpolation'
import { ensureCurve } from '../ingest'

export interface CurvaCarregada {
  interp: CurveInterpolator
  rate: { code: string; name: string }
  date: string
  vertices: number
}

export class CurvaIndisponivelError extends Error {
  status: string
  nearestAvailable?: string
  constructor(rateCode: string, date: string, status: string, message?: string, nearest?: string) {
    super(
      message ??
        `Curva ${rateCode} indisponível em ${date}${nearest ? ` (mais próxima: ${nearest})` : ''}.`,
    )
    this.status = status
    this.nearestAvailable = nearest
  }
}

export async function carregarInterpolador(rateCode: string, dateISO: string): Promise<CurvaCarregada> {
  const payload = await ensureCurve(rateCode, dateISO)
  if (payload.status !== 'OK' || payload.points.length === 0) {
    throw new CurvaIndisponivelError(
      rateCode,
      dateISO,
      payload.status,
      payload.message,
      payload.nearestAvailable,
    )
  }
  const has252 = payload.points.some((p) => p.rate252 !== null)
  const points = payload.points
    .map((p) => ({ days: p.days, rate: has252 ? p.rate252 : p.rate360 }))
    .filter((p): p is { days: number; rate: number } => p.rate !== null)
  return {
    interp: buildInterpolator(rateCode, dateISO, points),
    rate: payload.rate,
    date: payload.date,
    vertices: points.length,
  }
}
