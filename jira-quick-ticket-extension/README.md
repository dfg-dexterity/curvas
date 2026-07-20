# Jira Quick Ticket — extensão Chrome

Extensão (Manifest V3) que cria tickets no Jira a partir da página atual do navegador:

1. Clique no ícone da extensão em qualquer página;
2. Ela captura **título, URL e texto selecionado** e pré-preenche o formulário;
3. Você escolhe o **projeto** e o **tipo de ticket** (listas carregadas do próprio Jira);
4. Ao criar, ela mostra o **número do ticket** (ex.: `TAD-123`) com link direto e botão de copiar.

Substitui o bookmarklet que enviava os dados para um webhook do Zapier.

## Por que é melhor que o bookmarklet + Zapier

| | Bookmarklet + Zapier | Extensão |
|---|---|---|
| Retorna o número do ticket | ❌ (fire-and-forget) | ✅ com link e copiar |
| Escolher projeto | ❌ fixo (`TAD`) | ✅ qualquer projeto onde você pode criar |
| Escolher tipo de ticket | ❌ fixo (`Tarefa`) | ✅ tipos reais do projeto escolhido |
| Editar resumo/descrição antes de enviar | prompt simples | formulário completo |
| Funciona em páginas com CSP restritivo | ❌ (form/iframe bloqueados) | ✅ (o popup roda fora da página) |
| Dependências externas | Zapier (webhook público) | nenhuma — fala direto com a API do Jira |
| Erros visíveis (campo obrigatório, permissão…) | ❌ silencioso | ✅ mensagem do Jira no popup |

## Instalação (modo desenvolvedor)

1. Baixe/clone este repositório;
2. Abra `chrome://extensions` no Chrome;
3. Ative **Modo do desenvolvedor** (canto superior direito);
4. Clique em **Carregar sem compactação** e selecione a pasta `jira-quick-ticket-extension/`;
5. (Opcional) Fixe a extensão na barra pelo ícone de quebra-cabeça.

Para distribuir ao time sem a Chrome Web Store: compartilhe a pasta (ou o repositório) e cada
pessoa carrega sem compactação — ou publique na Web Store como extensão privada/não listada
(conta de desenvolvedor, taxa única de US$ 5).

## Configuração

1. Clique com o botão direito no ícone da extensão → **Opções** (ou clique na engrenagem do popup);
2. Informe:
   - **URL do Jira** — já vem `https://dexterityit.atlassian.net`;
   - **E-mail** da sua conta Atlassian;
   - **API token** — gere em [id.atlassian.com → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens);
3. Use **Testar conexão** e depois **Salvar**.

Segurança: o token fica somente no `chrome.storage.local` do seu navegador e é enviado
apenas para o site Jira configurado (`host_permissions` restrito a `*.atlassian.net`).
O ticket é criado em seu nome (relator = você), diferente do webhook que criava tudo
com um usuário de integração.

## Uso

- O **resumo** vem pré-preenchido com o título da página (editável);
- A **descrição** traz título, URL e o trecho selecionado na página, se houver;
- Os últimos **projeto e tipo usados** ficam memorizados como padrão;
- A lista de projetos é cacheada por 24 h — o botão **↻ Projetos** força a atualização;
- Após criar, use **Copiar chave** ou clique no número para abrir o ticket no Jira.

## Estrutura

```
jira-quick-ticket-extension/
├── manifest.json        # Manifest V3 (permissions: activeTab, scripting, storage)
├── popup.html/.js       # formulário de criação do ticket
├── options.html/.js     # credenciais (URL, e-mail, API token)
├── jira.js              # cliente da API REST do Jira Cloud (v3) + conversão texto→ADF
├── styles.css
└── icons/               # PNGs gerados por icons/generate.mjs (node icons/generate.mjs)
```

## Limitações conhecidas

- Projetos cujo tipo de ticket exige **campos obrigatórios extras** (além de resumo/descrição)
  retornam o erro do Jira no popup — crie por lá ou ajuste a tela de criação do projeto;
- Sites Jira com **domínio próprio** (fora de `*.atlassian.net`) exigem ajustar
  `host_permissions` no `manifest.json`;
- Em páginas restritas (`chrome://…`, Chrome Web Store) a extensão funciona,
  mas sem capturar título/seleção da página.
