// Proxy (Vercel): /api/fed?tipo=sofr[&n=13] -> NY Fed Markets API
// Devolve o JSON do NY Fed como vem: { "refRates": [{ "effectiveDate": "AAAA-MM-DD", ... }] }
// Sem "n", devolve o histórico completo disponível.
const GRUPOS = {
  sofr: "secured",
  sofrai: "secured",
  tgcr: "secured",
  bgcr: "secured",
  effr: "unsecured",
  obfr: "unsecured",
};

// fetch + leitura do corpo sob o MESMO deadline. O fetch resolve ao receber os
// cabeçalhos, então o timer precisa seguir ativo enquanto o corpo é consumido —
// um corpo travado prenderia a função até o timeout da Vercel. Retorna { r, body },
// com body já lido (texto/JSON) apenas quando a resposta é OK.
async function fetchWithTimeout(url, { as, timeoutMs = 8000, ...opts } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    const body = r.ok && as === "text" ? await r.text()
               : r.ok && as === "json" ? await r.json()
               : undefined;
    return { r, body };
  } finally {
    clearTimeout(t);
  }
}

module.exports = async (req, res) => {
  // CORS em todas as respostas (inclusive 400/502/504), senão o browser mascara
  // o erro real como "Failed to fetch" e o front não consegue exibi-lo.
  res.setHeader("Access-Control-Allow-Origin", "*");

  const tipo = String((req.query && req.query.tipo) || "sofr").trim().toLowerCase();
  const grupo = GRUPOS[tipo];
  if (!grupo) {
    res.status(400).json({ erro: `Parâmetro 'tipo' inválido: ${tipo}. Use ${Object.keys(GRUPOS).join(", ")}.` });
    return;
  }

  // Paginação opcional: se "n" vier, precisa ser inteiro positivo. Um valor
  // malformado (ex.: "abc", "0", "-3") responde 400 em vez de cair silenciosamente
  // no histórico completo.
  const nRaw = req.query && req.query.n;
  const n = String(nRaw == null ? "" : nRaw).trim();
  if (n !== "" && !(/^\d+$/.test(n) && Number(n) > 0)) {
    res.status(400).json({ erro: "Parâmetro 'n' inválido (esperado inteiro positivo)." });
    return;
  }

  const url = n !== ""
    ? `https://markets.newyorkfed.org/api/rates/${grupo}/${tipo}/last/${n}.json`
    : `https://markets.newyorkfed.org/api/rates/${grupo}/${tipo}/search.json?startDate=2000-01-01`;

  try {
    const { r, body } = await fetchWithTimeout(url, { as: "json", headers: { Accept: "application/json" } });
    if (!r.ok) {
      res.status(r.status).json({ erro: `NY Fed respondeu HTTP ${r.status}` });
      return;
    }
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=86400");
    res.status(200).json(body);
  } catch (err) {
    if (err && err.name === "AbortError") {
      res.status(504).json({ erro: "Tempo esgotado ao consultar o NY Fed." });
      return;
    }
    res.status(502).json({ erro: `Falha ao consultar o NY Fed: ${err.message}` });
  }
};
