// Proxy (Vercel): /api/sgs?codigo=433[&ultimos=13] -> API SGS do Banco Central
// Devolve o JSON do SGS como vem: [{ "data": "DD/MM/AAAA", "valor": "..." }, ...]
//
// Histórico completo (sem "ultimos"): o SGS rejeita a consulta aberta das séries
// DIÁRIAS (SELIC 11, CDI 12, ...) com HTTP 406 e limita cada consulta a 10 anos.
// Então tentamos primeiro a consulta aberta (comportamento inalterado para séries
// mensais/anuais, que respondem normalmente) e só caímos no janelamento <= 10 anos
// quando o BCB devolve 406.

// fetch com deadline: aborta a requisição upstream antes do timeout da função.
async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

const pad2 = (v) => String(v).padStart(2, "0");

// Busca o histórico completo em janelas de <= 10 anos e concatena (ascendente).
// Janelas fora do intervalo da série devolvem 404/[] e são ignoradas.
async function fetchHistoricoJanelado(base) {
  const hoje = new Date();
  const anoFim = hoje.getUTCFullYear();
  const dataFinalHoje = `${pad2(hoje.getUTCDate())}/${pad2(hoje.getUTCMonth() + 1)}/${anoFim}`;

  const janelas = [];
  for (let ini = 1970; ini <= anoFim; ini += 10) {
    const fim = Math.min(ini + 9, anoFim);
    const dataFinal = fim === anoFim ? dataFinalHoje : `31/12/${fim}`;
    janelas.push([`01/01/${ini}`, dataFinal]);
  }

  const partes = await Promise.all(janelas.map(async ([di, df]) => {
    const url = `${base}?formato=json&dataInicial=${di}&dataFinal=${df}`;
    const r = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
    if (r.status === 404) return []; // período sem dados para a série
    if (!r.ok) {
      const e = new Error(`SGS respondeu HTTP ${r.status}`);
      e.status = r.status;
      throw e;
    }
    const arr = await r.json();
    return Array.isArray(arr) ? arr : [];
  }));

  return partes.flat();
}

module.exports = async (req, res) => {
  const codigo = String((req.query && req.query.codigo) || "").trim();
  if (!/^\d+$/.test(codigo)) {
    res.status(400).json({ erro: "Parâmetro 'codigo' inválido (esperado número da série SGS)." });
    return;
  }

  // Paginação opcional: se "ultimos" vier, precisa ser inteiro positivo.
  const ultimosRaw = req.query && req.query.ultimos;
  const ultimos = String(ultimosRaw == null ? "" : ultimosRaw).trim();
  if (ultimos !== "" && !(/^\d+$/.test(ultimos) && Number(ultimos) > 0)) {
    res.status(400).json({ erro: "Parâmetro 'ultimos' inválido (esperado inteiro positivo)." });
    return;
  }

  const base = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados`;

  try {
    let dados;
    if (ultimos !== "") {
      const r = await fetchWithTimeout(`${base}/ultimos/${ultimos}?formato=json`, { headers: { Accept: "application/json" } });
      if (!r.ok) {
        res.status(r.status).json({ erro: `SGS respondeu HTTP ${r.status}` });
        return;
      }
      dados = await r.json();
    } else {
      const r = await fetchWithTimeout(`${base}?formato=json`, { headers: { Accept: "application/json" } });
      if (r.ok) {
        dados = await r.json();
      } else if (r.status === 406) {
        // Série diária: consulta aberta barrada pelo BCB -> janela em <= 10 anos.
        dados = await fetchHistoricoJanelado(base);
      } else {
        res.status(r.status).json({ erro: `SGS respondeu HTTP ${r.status}` });
        return;
      }
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=86400");
    res.status(200).json(dados);
  } catch (err) {
    if (err && err.name === "AbortError") {
      res.status(504).json({ erro: "Tempo esgotado ao consultar o SGS." });
      return;
    }
    if (err && err.status) {
      res.status(err.status).json({ erro: err.message });
      return;
    }
    res.status(502).json({ erro: `Falha ao consultar o SGS: ${err.message}` });
  }
};
