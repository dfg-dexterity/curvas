'use client'

import { useSyncExternalStore } from 'react'

/**
 * Paleta de visualização (instância de referência da skill de dataviz),
 * validada por modo com scripts/validate_palette.js:
 *  - light (superfície #fcfcfb): CVD adjacente pior par ΔE 24,2 (PASS);
 *    aqua/amarelo abaixo de 3:1 → mitigado com tooltip + tabela de dados.
 *  - dark  (superfície #1a1a19): contraste ≥3:1 em todos; CVD pior par 10,3
 *    (banda-piso) → mitigado com rótulos diretos nas pontas das linhas.
 * A ordem dos slots é fixa (mecanismo de segurança CVD) — nunca reordenar.
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
  series: ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948'],
  surface: '#fcfcfb',
  page: '#f9f9f7',
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
}

export const DARK: VizTheme = {
  series: ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767'],
  surface: '#1a1a19',
  page: '#0d0d0d',
  ink: '#ffffff',
  ink2: '#c3c2b7',
  muted: '#898781',
  grid: '#2c2c2a',
  axis: '#383835',
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
