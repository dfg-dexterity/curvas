// Popup: captura a página atual, deixa escolher projeto/tipo e cria o ticket.
import { getSettings, fetchProjects, fetchIssueTypes, createIssue, browseUrl } from './jira.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['view-loading', 'view-setup', 'view-form', 'view-success'];
const PROJECTS_TTL_MS = 24 * 60 * 60 * 1000; // lista de projetos é recarregada 1x/dia

let settings = null;
let projects = [];
let prefs = {};
let typeLoadToken = 0;

function showView(id) {
  for (const view of VIEWS) $(view).hidden = view !== id;
}

function showError(message) {
  const box = $('form-error');
  box.textContent = message;
  box.hidden = false;
}

function hideError() {
  $('form-error').hidden = true;
}

async function fillFromCurrentTab() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    tab = undefined;
  }
  const title = (tab?.title || '').trim();
  const url = (tab?.url || '').trim();
  let selected = '';
  if (tab?.id != null) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => String(window.getSelection ? window.getSelection() : ''),
      });
      selected = (result?.result || '').trim();
    } catch {
      // Páginas restritas (chrome://, Chrome Web Store…) não permitem ler a seleção.
    }
  }
  $('summary').value = title || url;
  const lines = [];
  if (title) lines.push(`Página: ${title}`);
  if (url) lines.push(`URL: ${url}`);
  if (selected) lines.push('', 'Trecho selecionado:', selected);
  $('description').value = lines.join('\n');
}

async function loadCachedProjects() {
  const { projectsCache } = await chrome.storage.local.get('projectsCache');
  return projectsCache?.projects?.length ? projectsCache : null;
}

async function refreshProjects({ force = false, silent = false } = {}) {
  if (!force) {
    const cache = await loadCachedProjects();
    if (cache && Date.now() - cache.fetchedAt < PROJECTS_TTL_MS) return;
  }
  const btn = $('btn-refresh');
  btn.disabled = true;
  try {
    projects = await fetchProjects(settings);
    await chrome.storage.local.set({ projectsCache: { fetchedAt: Date.now(), projects } });
    renderProjects();
  } catch (err) {
    if (!silent) throw err;
  } finally {
    btn.disabled = false;
  }
}

function renderProjects() {
  const filter = $('project-filter').value.trim().toLowerCase();
  const select = $('project');
  const previous = select.value || prefs.lastProjectId;
  select.innerHTML = '';
  const shown = projects.filter(
    (p) => !filter || p.name.toLowerCase().includes(filter) || p.key.toLowerCase().includes(filter),
  );
  for (const project of shown) {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = `${project.name} (${project.key})`;
    select.appendChild(option);
  }
  if (previous && shown.some((p) => p.id === previous)) select.value = previous;
  onProjectChange();
}

async function onProjectChange() {
  const token = ++typeLoadToken;
  const select = $('issue-type');
  select.innerHTML = '';
  const project = projects.find((p) => p.id === $('project').value);
  if (!project) return;
  let types = project.issueTypes || [];
  if (!types.length) {
    try {
      types = await fetchIssueTypes(settings, project.id);
    } catch {
      types = [];
    }
    if (token !== typeLoadToken) return; // outro projeto foi selecionado enquanto carregava
    project.issueTypes = types;
  }
  for (const type of types) {
    const option = document.createElement('option');
    option.value = type.id;
    option.textContent = type.name;
    select.appendChild(option);
  }
  const last = prefs.lastIssueTypeByProject?.[project.id];
  if (last && types.some((t) => t.id === last)) select.value = last;
}

async function onCreate() {
  const projectId = $('project').value;
  const issueTypeId = $('issue-type').value;
  const summary = $('summary').value.trim();
  hideError();
  if (!projectId) {
    showError('Escolha um projeto.');
    return;
  }
  if (!issueTypeId) {
    showError('Escolha o tipo de ticket.');
    return;
  }
  if (!summary) {
    showError('Informe o resumo do ticket.');
    return;
  }

  const btn = $('btn-create');
  btn.disabled = true;
  btn.textContent = 'Criando…';
  try {
    const issue = await createIssue(settings, {
      projectId,
      issueTypeId,
      summary,
      description: $('description').value,
    });
    prefs = {
      ...prefs,
      lastProjectId: projectId,
      lastIssueTypeByProject: { ...(prefs.lastIssueTypeByProject || {}), [projectId]: issueTypeId },
    };
    await chrome.storage.local.set({ prefs });
    const link = $('ticket-link');
    link.textContent = issue.key;
    link.href = browseUrl(settings, issue.key);
    $('ticket-summary').textContent = summary;
    $('btn-copy').textContent = 'Copiar chave';
    showView('view-success');
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Criar ticket';
  }
}

async function copyTicketKey() {
  const key = $('ticket-link').textContent;
  try {
    await navigator.clipboard.writeText(key);
  } catch {
    const area = document.createElement('textarea');
    area.value = key;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  $('btn-copy').textContent = 'Copiado ✓';
}

async function init() {
  $('btn-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('btn-open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

  settings = await getSettings();
  if (!settings) {
    showView('view-setup');
    return;
  }

  prefs = (await chrome.storage.local.get('prefs')).prefs || {};

  $('ticket-form').addEventListener('submit', (event) => {
    event.preventDefault();
    onCreate();
  });
  $('project-filter').addEventListener('input', renderProjects);
  $('project-filter').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault(); // Enter no filtro não deve criar o ticket
  });
  $('project').addEventListener('change', onProjectChange);
  $('btn-refresh').addEventListener('click', () =>
    refreshProjects({ force: true }).catch((err) => showError(err.message)),
  );
  $('btn-copy').addEventListener('click', copyTicketKey);
  $('btn-again').addEventListener('click', () => {
    hideError();
    showView('view-form');
  });

  await fillFromCurrentTab();

  const cache = await loadCachedProjects();
  if (cache) {
    projects = cache.projects;
    renderProjects();
    showView('view-form');
    refreshProjects({ silent: true }); // atualiza em segundo plano quando o cache está velho
  } else {
    try {
      await refreshProjects({ force: true });
      showView('view-form');
    } catch (err) {
      showView('view-form');
      showError(err.message);
    }
  }
}

init();
