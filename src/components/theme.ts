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
  surface: '#ffffff',
  page: '#f4f6f9',
  ink: '#0e1320',
  ink2: '#465065',
  muted: '#7b8398',
  grid: '#e7eaf1',
  axis: '#c9cfdc',
}

export const DARK: VizTheme = {
  series: ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767'],
  surface: '#141927',
  page: '#0b0e15',
  ink: '#f2f4f8',
  ink2: '#b7becd',
  muted: '#7e8699',
  grid: '#232a3b',
  axis: '#394155',
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
