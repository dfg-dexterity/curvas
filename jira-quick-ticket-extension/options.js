// Página de configurações: URL do Jira, e-mail e API token.
import { saveSettings, testConnection, normalizeBaseUrl } from './jira.js';

const $ = (id) => document.getElementById(id);

function readForm() {
  return {
    baseUrl: normalizeBaseUrl($('base-url').value),
    email: $('email').value.trim(),
    token: $('token').value.trim(),
  };
}

function showStatus(message, kind) {
  const box = $('status');
  box.textContent = message;
  box.className = `status ${kind}`;
  box.hidden = false;
}

async function init() {
  const { settings } = await chrome.storage.local.get('settings');
  if (settings) {
    $('base-url').value = settings.baseUrl || '';
    $('email').value = settings.email || '';
    $('token').value = settings.token || '';
  } else {
    $('base-url').value = 'https://dexterityit.atlassian.net';
  }

  $('btn-toggle-token').addEventListener('click', () => {
    const input = $('token');
    const hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    $('btn-toggle-token').textContent = hidden ? 'Ocultar' : 'Mostrar';
  });

  $('btn-test').addEventListener('click', async () => {
    const form = readForm();
    if (!form.email || !form.token) {
      showStatus('Preencha e-mail e API token.', 'error');
      return;
    }
    showStatus('Testando…', 'info');
    try {
      const me = await testConnection(form);
      showStatus(`Conectado como ${me.displayName} (${me.emailAddress || form.email}).`, 'ok');
    } catch (err) {
      showStatus(err.message, 'error');
    }
  });

  $('btn-save').addEventListener('click', async () => {
    const form = readForm();
    if (!form.email || !form.token) {
      showStatus('Preencha e-mail e API token.', 'error');
      return;
    }
    await saveSettings(form);
    showStatus('Salvo! Já pode usar o popup da extensão.', 'ok');
  });
}

init();
