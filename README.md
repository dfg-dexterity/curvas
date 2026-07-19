# Curvas B3 — Taxas Referenciais

> **Produção:** <https://project-c9zq2.vercel.app> — Vercel (time `diegogozers-projects`,
> projeto `project-c9zq2` reaproveitado) + Supabase Postgres (`curvas-b3`, sa-east-1).
> O deploy foi feito por upload de arquivos (o token da integração não cria projetos);
> cron diário registrado em `vercel.json` roda ~21h30 (São Paulo) em dias úteis.
> Diagnóstico de captura: `GET /api/debug/b3?secret=$CRON_SECRET&date=AAAA-MM-DD`.

Dashboard de curvas de juros com **todas as Taxas Referenciais publicadas pela B3**
([página oficial](https://sistemaswebb3-derivativos.b3.com.br/referenceRatesPage/all?language=pt-br)):
DI x pré, cupom cambial, DI x IPCA, DI x IGP-M, Selic x pré, TR, cupons de moeda e as demais.

- **Job diário** que captura todas as taxas e alimenta um Postgres (histórico próprio, consultas instantâneas).
- **Consulta retroativa de qualquer data**: se a data pedida ainda não está no banco, o servidor busca na hora
  direto da B3, grava e responde — sem precisar de backfill prévio.
- **Comparação de curvas** de até 6 datas sobrepostas, bases 252 (dias úteis) e 360 (dias corridos),
  vértices-chave interpolados, histórico por prazo, tabela com os vértices originais e export CSV.
- **Descoberta automática das taxas**: a lista de curvas não é fixa no código — o job lê o dropdown da
  página da B3 a cada execução; taxas novas entram sozinhas e descontinuadas são marcadas (histórico preservado).

## Como funciona

```
┌────────────┐   cron diário / CLI    ┌──────────────┐
│  B3 (site) │ ◄───────────────────── │  Ingestão    │──► Postgres (RateType,
│  Taxas     │   on-demand (retro)    │  src/lib/    │      CurvePoint, FetchLog)
│  Referen.  │ ◄───────────────────── │  ingest.ts   │            │
└────────────┘                        └──────────────┘            ▼
                                                          API (Next.js routes)
                                                                  │
                                                                  ▼
                                                          Dashboard (React)
```

A fonte é o endpoint público de Taxas Referenciais BM&F
(`www2.bmf.com.br/pages/portal/bmfbovespa/lumis/lum-taxas-referenciais-bmf-ptBR.asp`),
que aceita qualquer data histórica (`Data=DD/MM/AAAA`, `Data1=AAAAMMDD`, `slcTaxa=CODIGO`)
— é o mesmo dataset exibido na página nova de Taxas de Referência da B3.
O parser (`src/lib/b3/parse.ts`) é defensivo contra variações do HTML antigo
(tabelas aninhadas, cabeçalhos com rowspan, decimais pt-BR, latin1) e classifica cada captura em
`OK`, `EMPTY` (feriado/sem publicação — mensagem oficial da B3) ou `ERROR` (re-tentável).

## Rodando localmente

Requisitos: Node 20.19+, Docker (para o Postgres local).

```bash
cp .env.example .env         # ajuste se necessário
npm install                  # roda prisma generate no postinstall
npm run db:up                # Postgres via docker compose
npm run db:migrate           # aplica as migrações
npm run dev                  # http://localhost:3000
```

Na primeira visita a UI já funciona: a lista de taxas é semeada e a curva do último
dia útil é buscada da B3 na hora. Para popular o histórico:

```bash
# captura o dia atual + últimos 5 dias úteis de todas as taxas
npm run job:daily

# preenche um período (reexecutável; datas já capturadas são puladas)
npm run job:backfill -- --from=2024-01-02 --to=2024-12-30
npm run job:backfill -- --from=2015-01-02 --rates=PRE,DIC,DOC   # só algumas taxas
```

Diagnóstico da comunicação com a B3 (não grava nada):

```bash
npm run probe -- --date=2024-06-14 --rate=PRE --save=pagina.html
```

## Atualização diária

**No Vercel** (recomendado): o `vercel.json` já define o cron `30 0 * * *`
(00:30 UTC = 21:30 em São Paulo, após a publicação das taxas do dia) chamando
`/api/cron/daily`. Configure as variáveis:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | Postgres (Supabase/Neon; com Supabase use o pooler em modo transação, porta 6543) |
| `CRON_SECRET` | segredo forte — o Vercel envia `Authorization: Bearer $CRON_SECRET` automaticamente |

O job é **idempotente e incremental**: reprocessa apenas (taxa × data) pendentes dos
últimos `JOB_CATCHUP_BDAYS` (padrão 5) dias úteis, então execuções interrompidas ou
duplicadas convergem sozinhas. No plano Hobby a duração de função é limitada — se a
primeira execução não concluir, as seguintes continuam de onde parou (ou rode
`npm run job:daily` uma vez para aquecer).

**Fora do Vercel**: agende `npm run job:daily` (cron do sistema, systemd timer,
GitHub Actions etc.) num ambiente com `DATABASE_URL`. Exemplo de crontab:

```cron
30 21 * * 1-5  cd /app/curvas && npm run job:daily >> /var/log/curvas.log 2>&1
```

## API

| Endpoint | Descrição |
|---|---|
| `GET /api/rates` | Taxas conhecidas + cobertura no banco (de/até, nº de datas) |
| `GET /api/curves?rate=PRE&date=2020-05-15` | Curva da taxa na data; se faltar no banco, busca na B3 e grava (`fetch=0` desativa) |
| `GET /api/curves/compare?rate=PRE&dates=2024-01-15,2020-01-15` | Até 6 datas da mesma taxa |
| `GET /api/history?rate=PRE&days=365&from=…&to=…` | Série temporal de um prazo fixo (interpolação linear; só usa o banco) |
| `GET /api/cron/daily` | Dispara o job (exige `Authorization: Bearer CRON_SECRET` ou `?secret=`) |

Respostas de curva incluem `status` (`OK`/`EMPTY`/`ERROR`), `source` (`db`/`b3`) e,
quando vazio, `nearestAvailable` (data mais próxima com dados).

## Banco de dados

- **`RateType`** — código `slcTaxa` (PK), nome exibido na B3, `active`, primeiro/último avistamento.
- **`CurvePoint`** — PK composta (`rateCode`, `date`, `days`); `rate252` e `rate360`
  em `DECIMAL(12,6)` (% a.a.), nulos quando a curva não publica a base.
- **`FetchLog`** — resultado de cada captura (taxa × data): status, nº de pontos, mensagem.
  É o que torna jobs/backfills reexecutáveis e evita re-consultar feriados antigos.

## Testes

```bash
npm test        # parser (fixtures do HTML da B3), calendário B3, interpolação, concorrência
npm run lint
npm run build
```

## Limitações e notas

- A B3 pode bloquear IPs de datacenter estrangeiros; rode o job/probe de um ambiente com
  acesso (o `User-Agent` de navegador já é enviado). `B3_TR_URL` permite apontar para um mirror/proxy.
- Se a B3 mudar a estrutura da página, as capturas viram `ERROR` (re-tentáveis, visíveis no
  `FetchLog`) em vez de gravar dados errados; use `npm run probe` para inspecionar e ajustar o parser.
- Curvas descontinuadas (ex.: Libor) somem do dropdown da B3, ficam `active=false` e o
  histórico permanece consultável.
- Dados de uso informativo, sem garantia — confira sempre na fonte oficial da B3.

---

## Apps auxiliares (mesma consolidação Vercel)

Além do dashboard **Curvas B3** acima (deployado como `project-c9zq2`), este repositório
reúne dois apps estáticos independentes, recuperados da conta Vercel hobby
(`diegogozers-projects`) para consolidação na conta **dexterityit**. Cada um é um projeto
Vercel próprio, sem build step e sem variáveis de ambiente:

| Pasta | Projeto Vercel | O que é |
|---|---|---|
| `bndes-um/` | `bndes-um` | Séries UM (Moedas Contratuais) do BNDES: gráfico, tabela e export CSV/XLSX |
| `taxas-indices/` | `taxas-indices` | Painel de taxas e índices (SELIC, CDI, IPCA, TLP‑IPCA/BNDES, SOFR e demais taxas do NY Fed), com export para SAP |

Os `index.html` são cópias exatas dos deploys em produção. Os proxies em `api/`
(Vercel Functions) foram reconstruídos a partir do contrato usado pelos frontends:

- `api/um.js` — `/api/um?code=NNN` → `https://www.bndes.gov.br/Moedas/umNNN.txt` (texto puro)
- `api/sgs.js` — `/api/sgs?codigo=NNN[&ultimos=K]` → API SGS do Banco Central (JSON)
- `api/fed.js` — `/api/fed?tipo=sofr[&n=K]` → NY Fed Markets API (JSON `refRates`)

Para recriar cada um na conta dexterityit: **Add New → Project → Import** deste
repositório → **Root Directory** = `bndes-um` ou `taxas-indices` → Deploy. Com o
repositório conectado, todo push atualiza os sites automaticamente.
