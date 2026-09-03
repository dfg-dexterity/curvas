# Identidade visual — Dexterity IT Solutions

Referência única do estilo aplicado neste app. Os valores vêm dos ativos
oficiais da marca (template institucional `.docx`) e do baralho de valores
publicado como artefato.

## Cores

| Papel | Claro | Escuro |
| --- | --- | --- |
| `--paper` (fundo da página) | `#F7F3E7` | `#242322` |
| `--card-bg` (carta) | `#FFFFFF` | `#2E2C2A` |
| `--ink-1` (texto) | `#4D4D4D` | `#F0EBDD` |
| `--ink-soft` (texto secundário) | `#7A7670` | `#A9A499` |
| `--ink-faint` (texto terciário) | `#B6B1A6` | `#6E6A62` |
| `--rule` (filetes e bordas) | `#DED8C6` | `#3B3936` |

Naipes (acentos), na ordem de uso: `--cerceta` `#009994`, `--roxo` `#98569A`,
`--amarelo` `#FFA436`, `--musgo` `#597C59`, `--grafite` `#4D4D4D`. Cada um tem
uma variante escura para uso em texto/ícone sobre o creme, onde o tom da marca
não alcança contraste: `--cerceta-fundo` `#00706C` e `--amarelo-fundo`
`#8A5800` (o amarelo da marca tem só 1,8:1 sobre o papel).

## Tipografia

- Títulos, rótulos e números de destaque: **Barlow Condensed** 500/600/700 —
  equivalente web da Proxima Soft ExCn da marca impressa.
- Corpo: **Figtree** 400–700 — equivalente web da Boston.
- Números que se comparam usam `font-variant-numeric: tabular-nums`.

## Componentes

- **Carta**: fundo `--card-bg`, borda `--rule`, raio **4px**, sombra
  `--shadow-dex`. Raio de controles: **3px**. Nada mais arredondado que isso.
- **Assinatura da marca**: filete colorido de **14px** na borda esquerda da
  carta (`.card-suit` + `.suit-*`), na cor do naipe da seção.
- **Chips**: pílula (`border-radius: 100px`), borda `--rule`, texto
  `--ink-soft`; ativo ganha borda `--ink-1` e peso 600.
- **Botão sólido** (`.btn-dex`): fundo `--ink-1`, texto `--paper`.
- **Foco**: `outline: 2px solid var(--cerceta); outline-offset: 2px`.
- Respeita `prefers-reduced-motion`.

## Paleta de gráficos

Fica em `src/components/theme.ts` e é validada por
`node scripts/validate_palette.mjs`: contraste de cada série ≥ 3:1 contra a
superfície e separação ΔE ≥ 12 entre **todos** os pares, na visão tricromata e
sob deuteranopia, protanopia e tritanopia. As claridades são escalonadas de
propósito — é a diferença de L\* que sustenta a leitura sob dicromacia. Rode o
validador antes de mexer em qualquer cor de série.
