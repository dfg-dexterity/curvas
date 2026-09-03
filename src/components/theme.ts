'use client'

import { useSyncExternalStore } from 'react'

/**
 * Paleta de visualização — ancorada nos naipes da marca Dexterity.
 *
 * Validada por `node scripts/validate_palette.mjs`, que checa, nos dois modos:
 *  - contraste de cada série contra a superfície do gráfico >= 3:1
 *    (WCAG 2.1 SC 1.4.11, elementos gráficos);
 *  - separação ΔE entre slots ADJACENTES >= 20 na visão tricromata e sob
 *    deuteranopia, protanopia e tritanopia (simulação de Viénot 1999).
 *
 * Resultado atual: pior par ΔE 19,5 (light) e 14,3 (dark) — contra 4,6 e 0,9
 * da paleta anterior — com todos os contrastes acima de 3:1. As claridades
 * são escalonadas de propósito: é a diferença de L* que sustenta a leitura
 * sob dicromacia, já que o eixo vermelho-verde colapsa. Cerceta da marca
 * lidera e o vermelho fica no último slot, para não sugerir "negativo" numa
 * curva qualquer. Nunca reordenar sem rodar o validador de novo.
 */
export interface VizTheme {
  series: string[]
  surface: string
  page: string
  ink: string
  ink2: string
  muted: string
  grid: string
  axis: string
}

export const LIGHT: VizTheme = {
  series: ['#009691', '#ad6600', '#6b1171', '#073911', '#4b4b4b', '#b6002f'],
  surface: '#ffffff',
  page: '#f7f3e7',
  ink: '#4d4d4d',
  ink2: '#7a7670',
  muted: '#b6b1a6',
  grid: '#ece7d8',
  axis: '#ded8c6',
}

export const DARK: VizTheme = {
  series: ['#018b86', '#c97800', '#feb2ff', '#96c896', '#d1ccbd', '#ff4358'],
  surface: '#2e2c2a',
  page: '#242322',
  ink: '#f0ebdd',
  ink2: '#a9a499',
  muted: '#6e6a62',
  grid: '#3b3936',
  axis: '#4a4744',
}

/** Máximo de curvas sobrepostas — limitado pelos slots categóricos validados. */
export const MAX_COMPARE = LIGHT.series.length

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

export function useIsDark(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
    () => false,
  )
}

export function useVizTheme(): VizTheme {
  return useIsDark() ? DARK : LIGHT
}
