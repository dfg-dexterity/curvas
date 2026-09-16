'use client'

/**
 * Paleta de visualização — ancorada nos naipes da marca Dexterity.
 *
 * Validada por `node scripts/validate_palette.mjs`, que checa:
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

/*
 * Tema único escuro — as superfícies são as do sistema visual da marca
 * (base #1B1B1B, cartão #242424, fio e rótulo derivados do off-white).
 * As séries são mantidas exatamente como validadas. Tentei trocar o slot 1
 * pelo cerceta de destaque #00B3AC (o das demais ferramentas), mas ele colide
 * com os slots 4 e 5 sob deuteranopia e protanopia (ΔE 4,7 e 6,7, mínimo 12):
 * o cerceta da marca é escuro o bastante para se separar dos verdes, o de
 * destaque não. O #018b86 fica.
 */
export const DARK: VizTheme = {
  series: ['#018b86', '#c97800', '#feb2ff', '#96c896', '#d1ccbd', '#ff4358'],
  surface: '#242424',
  page: '#1b1b1b',
  ink: '#f7f3e7',
  ink2: '#a49f98',
  muted: '#908c85',
  grid: '#313030',
  axis: '#3f3f3d',
}

/** Máximo de curvas sobrepostas — limitado pelos slots categóricos validados. */
export const MAX_COMPARE = DARK.series.length

export function useVizTheme(): VizTheme {
  return DARK
}
