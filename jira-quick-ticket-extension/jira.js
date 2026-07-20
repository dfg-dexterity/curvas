// Cliente mínimo da API REST do Jira Cloud (autenticação básica: e-mail + API token).

const DEFAULT_BASE_URL = 'https://dexterityit.atlassian.net';

export function normalizeBaseUrl(raw) {
  let url = (raw || '').trim();
  if (!url) return DEFAULT_BASE_URL;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, '');
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings || !settings.email || !settings.token) return null;
  return { ...settings, baseUrl: normalizeBaseUrl(settings.baseUrl) };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

export class JiraError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// btoa direto quebra com caracteres fora de latin1; a API espera UTF-8.
function toBase64(text) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

export async function jiraFetch(settings, path, options = {}) {
  const headers = {
    Authorization: `Basic ${toBase64(`${settings.email}:${settings.token}`)}`,
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
  };
  let res;
  try {
    res = await fetch(settings.baseUrl + path, { ...options, headers });
  } catch {
    throw new JiraError(`Não foi possível conectar a ${settings.baseUrl}. Verifique a URL e sua rede.`, 0);
  }
  if (!res.ok) throw new JiraError(await readErrorMessage(res), res.status);
  if (res.status === 204) return null;
  return res.json();
}

async function readErrorMessage(res) {
  const fallback =
    {
      400: 'Requisição inválida — o projeto pode exigir campos obrigatórios extras.',
      401: 'Credenciais inválidas. Confira o e-mail e o API token nas configurações.',
      403: 'Sem permissão para esta operação no Jira.',
      404: 'Recurso não encontrado — confira a URL do Jira nas configurações.',
    }[res.status] || `Erro ${res.status} na API do Jira.`;
  try {
    const data = await res.json();
    const messages = [
      ...(data.errorMessages || []),
      ...Object.entries(data.errors || {}).map(([field, msg]) => `${field}: ${msg}`),
    ];
    return messages.length ? messages.join(' • ') : fallback;
  } catch {
    return fallback;
  }
}

// Converte texto simples em Atlassian Document Format: linhas em branco separam
// parágrafos, quebras simples viram hardBreak.
export function textToAdf(text) {
  const blocks = String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trimEnd())
    .filter((block) => block.trim());
  const content = blocks.map((block) => {
    const inline = [];
    block.split('\n').forEach((line, i) => {
      if (i > 0) inline.push({ type: 'hardBreak' });
      if (line) inline.push({ type: 'text', text: line });
    });
    return { type: 'paragraph', content: inline };
  });
  return { type: 'doc', version: 1, content };
}

// Projetos onde o usuário pode criar tickets, com os tipos disponíveis.
export async function fetchProjects(settings) {
  const values = [];
  let startAt = 0;
  for (;;) {
    const page = await jiraFetch(
      settings,
      `/rest/api/3/project/search?action=create&expand=issueTypes&orderBy=name&maxResults=50&startAt=${startAt}`,
    );
    values.push(...(page.values || []));
    if (page.isLast || !page.values?.length) break;
    startAt = values.length;
  }
  return values.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    issueTypes: (p.issueTypes || [])
      .filter((t) => !t.subtask)
      .map((t) => ({ id: t.id, name: t.name })),
  }));
}

// Fallback quando o projeto não veio com issueTypes no expand.
export async function fetchIssueTypes(settings, projectId) {
  const page = await jiraFetch(settings, `/rest/api/3/issue/createmeta/${projectId}/issuetypes?maxResults=200`);
  return (page.issueTypes || page.values || [])
    .filter((t) => !t.subtask)
    .map((t) => ({ id: t.id, name: t.name }));
}

export async function createIssue(settings, { projectId, issueTypeId, summary, description }) {
  const fields = {
    project: { id: projectId },
    issuetype: { id: issueTypeId },
    summary,
  };
  const text = (description || '').trim();
  if (text) fields.description = textToAdf(text);
  return jiraFetch(settings, '/rest/api/3/issue', { method: 'POST', body: JSON.stringify({ fields }) });
}

export async function testConnection(settings) {
  return jiraFetch(settings, '/rest/api/3/myself');
}

export function browseUrl(settings, issueKey) {
  return `${settings.baseUrl}/browse/${issueKey}`;
}
