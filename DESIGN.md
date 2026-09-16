# Identidade visual — Dexterity IT Solutions

Referência única do estilo aplicado neste app. O sistema visual é o mesmo da
Calculadora CDI/CDB e das demais ferramentas de Dados de Mercado (taxas-indices,
bndes-um, tesourodireto, cotacao-derivativos-b3) — ao mudar algo aqui, confira se
vale para as outras.

## Cores

Tema **escuro único** — não há variante clara. Mesmo sistema visual da Calculadora
CDI/CDB e das demais ferramentas de Dados de Mercado.

| Papel | Valor |
| --- | --- |
| `--paper` (fundo da página) | `#1B1B1B` |
| `--card-bg` (carta) | `#242424` |
| `--surface-2` (realce) | `#2E2E2E` |
| `--ink-1` (texto) | `#F7F3E7` |
| `--ink-soft` (texto secundário) | `#A49F98` |
| `--ink-faint` (texto terciário) | `#908C85` |
| `--rule` (filetes e bordas) | `rgba(247,243,231,.13)` |

Naipes: `--cerceta` `#009994` com `--cerceta-fundo` `#00B3AC` para texto e acentos
sobre o escuro, `--roxo` `#98569A`, `--amarelo` `#FFA436`, `--musgo` `#597C59`,
`--vermelho` `#D9563E`.

**Cor tem sentido:** cerceta = alta/ganho, âmbar = baixa/atenção e foco, roxo = nota
informativa, vermelho **só** para erro.

## Tipografia

- Títulos, rótulos e números de destaque: **Barlow Condensed** 500/600/700, em caixa
  alta — equivalente web da Proxima Soft ExCn da marca impressa.
- Corpo: **Figtree** 300 — equivalente web da Boston.
- Rótulos técnicos e números que se comparam: **IBM Plex Mono** 400/500, com
  `font-variant-numeric: tabular-nums` (classes `.tabular`, `.dex-num`, `.dex-eyebrow`).

## Componentes

- **Carta**: fundo `--card-bg`, borda `--rule`, **canto reto** e **sem sombra**.
- **Assinatura da marca**: filete colorido de **2px** na borda esquerda da carta
  (`.card-suit` + `.suit-*`), na cor do naipe da seção. Era de 14px no tema claro;
  encolheu para caber na linguagem de fios finos.
- **Chips**: retos (sem cápsula), em mono caixa alta; o ativo ganha fio cerceta e
  texto `--cerceta-fundo`.
- **Botão sólido** (`.btn-dex`): fundo `--cerceta` com texto `--paper`, em Barlow
  Condensed caixa alta; inverte no hover.
- **Menu** (`SiteNav`): texto simples, sem cápsula; o ativo em `--cerceta-fundo`.
- **Foco**: `outline: 2px solid var(--amarelo); outline-offset: 3px`.

## Paleta de gráficos

Fica em `src/components/theme.ts` e é validada por
`node scripts/validate_palette.mjs`: contraste de cada série ≥ 3:1 contra a
superfície e separação ΔE ≥ 12 entre **todos** os pares, na visão tricromata e
sob deuteranopia, protanopia e tritanopia. As claridades são escalonadas de
propósito — é a diferença de L\* que sustenta a leitura sob dicromacia. Rode o
validador antes de mexer em qualquer cor de série.

Nota de quem já tentou: trocar o slot 1 pelo cerceta de destaque `#00B3AC` **reprova**
— ele colide com os slots 4 e 5 sob deuteranopia e protanopia (ΔE 4,7 e 6,7). O
`#018b86` é escuro o bastante para se separar dos verdes; o de destaque não é.
