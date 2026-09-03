/**
 * Validação da paleta de visualização.
 *
 * Checa, por modo (claro/escuro):
 *  1. contraste de cada série contra a superfície do gráfico (mínimo 3:1,
 *     WCAG 2.1 SC 1.4.11 para elementos gráficos);
 *  2. separação perceptual (ΔE CIE76) entre séries adjacentes e entre todos
 *     os pares, na visão tricromata e sob deuteranopia, protanopia e
 *     tritanopia (simulação de Viénot, Brettel & Mollon 1999).
 *
 * Uso: node scripts/validate_palette.mjs
 */

const MIN_CONTRASTE = 3
/*
 * Separação exigida entre QUALQUER par de séries — até seis curvas aparecem
 * juntas, então não basta cuidar dos slots vizinhos. 12 é o teto praticável
 * para seis categorias sob dicromacia mantendo contraste >= 3:1; a leitura
 * exata continua apoiada em tooltip, rótulos diretos e tabela de dados.
 */
const MIN_DELTA_E = 12

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const srgbToLinear = (c) => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const linearToSrgb = (v) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
  return Math.min(255, Math.max(0, Math.round(c * 255)))
}

const luminancia = (hex) => {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contraste = (a, b) => {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

/* --- Lab (D65) para ΔE --- */
function lab(hex) {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear)
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const [fx, fy, fz] = [f(x), f(y), f(z)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}
const deltaE = (a, b) => {
  const [l1, a1, b1] = lab(a)
  const [l2, a2, b2] = lab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

/* --- Simulação de dicromacia (Viénot, Brettel & Mollon 1999) --- */
const MATRIZ_CVD = {
  deuteranopia: [
    [0.625, 0.7, 0.0],
    [0.375, 0.3, 0.0],
    [0.0, 0.3, 1.0],
  ],
  protanopia: [
    [0.0, 2.02344, -2.52581],
    [0.0, 1.0, 0.0],
    [0.0, 0.0, 1.0],
  ],
  tritanopia: [
    [1.0, 0.0, 0.0],
    [0.0, 1.0, 0.0],
    [-0.395913, 0.801109, 0.0],
  ],
}
// LMS (Hunt-Pointer-Estevez normalizado a D65) e sua inversa.
const RGB_LMS = [
  [0.31399022, 0.63951294, 0.04649755],
  [0.15537241, 0.75789446, 0.08670142],
  [0.01775239, 0.10944209, 0.87256922],
]
const LMS_RGB = [
  [5.47221206, -4.6419601, 0.16963708],
  [-1.1252419, 2.29317094, -0.1678952],
  [0.02980165, -0.19318073, 1.16364789],
]
const mul = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2])

function simular(hex, tipo) {
  const lin = hexToRgb(hex).map(srgbToLinear)
  const lms = mul(RGB_LMS, lin)
  const proj = mul(MATRIZ_CVD[tipo], lms)
  const rgb = mul(LMS_RGB, proj)
  return '#' + rgb.map(linearToSrgb).map((c) => c.toString(16).padStart(2, '0')).join('')
}

export function validar(nome, series, superficie) {
  const problemas = []

  series.forEach((cor, i) => {
    const c = contraste(cor, superficie)
    if (c < MIN_CONTRASTE) {
      problemas.push(`${nome}: série ${i + 1} ${cor} tem contraste ${c.toFixed(2)}:1 contra ${superficie} (mínimo ${MIN_CONTRASTE})`)
    }
  })

  const visoes = ['normal', 'deuteranopia', 'protanopia', 'tritanopia']
  let piorGlobal = { deltaE: Infinity }
  let piorAdjacente = { deltaE: Infinity }
  for (const visao of visoes) {
    const vistas = series.map((c) => (visao === 'normal' ? c : simular(c, visao)))
    for (let i = 0; i < vistas.length; i++) {
      for (let j = i + 1; j < vistas.length; j++) {
        const d = deltaE(vistas[i], vistas[j])
        if (d < piorGlobal.deltaE) piorGlobal = { deltaE: d, visao, par: [i + 1, j + 1] }
        if (j === i + 1 && d < piorAdjacente.deltaE) {
          piorAdjacente = { deltaE: d, visao, par: [i + 1, j + 1] }
        }
        if (d < MIN_DELTA_E) {
          problemas.push(`${nome}/${visao}: séries ${i + 1} e ${j + 1} ficam a ΔE ${d.toFixed(1)} (mínimo ${MIN_DELTA_E})`)
        }
      }
    }
  }
  return { problemas, piorGlobal, piorAdjacente }
}

/* --- execução: lê a fonte única de verdade em theme.ts --- */
import { readFileSync } from 'node:fs'

function extrair(nome, fonte) {
  const bloco = new RegExp(`export const ${nome}: VizTheme = \\{([\\s\\S]*?)\\n\\}`).exec(fonte)
  if (!bloco) throw new Error(`tema ${nome} não encontrado em theme.ts`)
  const corpo = bloco[1]
  const series = /series:\s*\[([^\]]*)\]/.exec(corpo)[1].match(/#[0-9a-fA-F]{6}/g)
  const surface = /surface:\s*'(#[0-9a-fA-F]{6})'/.exec(corpo)[1]
  return { series, surface }
}

const fonte = readFileSync(new URL('../src/components/theme.ts', import.meta.url), 'utf8')
const LIGHT = extrair('LIGHT', fonte)
const DARK = extrair('DARK', fonte)

let falhou = false
for (const [nome, t] of [['light', LIGHT], ['dark', DARK]]) {
  const { problemas, piorGlobal, piorAdjacente } = validar(nome, t.series, t.surface)
  const contrastes = t.series.map((c) => contraste(c, t.surface).toFixed(2) + ':1').join('  ')
  console.log(`\n[${nome}] superfície ${t.surface}`)
  console.log(`  contrastes: ${contrastes}`)
  console.log(`  pior adjacente: ΔE ${piorAdjacente.deltaE.toFixed(1)} (${piorAdjacente.visao}, séries ${piorAdjacente.par.join(' e ')})`)
  console.log(`  pior par global: ΔE ${piorGlobal.deltaE.toFixed(1)} (${piorGlobal.visao}, séries ${piorGlobal.par.join(' e ')})`)
  if (problemas.length) {
    falhou = true
    problemas.forEach((p) => console.log('  FALHA ' + p))
  } else {
    console.log('  OK')
  }
}
process.exit(falhou ? 1 : 0)
