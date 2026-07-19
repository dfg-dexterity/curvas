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

module.exports = async (req, res) => {
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
    const r = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
    if (!r.ok) {
      res.status(r.status).json({ erro: `NY Fed respondeu HTTP ${r.status}` });
      return;
    }
    const dados = await r.json();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=86400");
    res.status(200).json(dados);
  } catch (err) {
    if (err && err.name === "AbortError") {
      res.status(504).json({ erro: "Tempo esgotado ao consultar o NY Fed." });
      return;
    }
    res.status(502).json({ erro: `Falha ao consultar o NY Fed: ${err.message}` });
  }
};
