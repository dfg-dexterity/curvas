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

module.exports = async (req, res) => {
  const tipo = String((req.query && req.query.tipo) || "sofr").trim().toLowerCase();
  const n = String((req.query && req.query.n) || "").trim();
  const grupo = GRUPOS[tipo];
  if (!grupo) {
    res.status(400).json({ erro: `Parâmetro 'tipo' inválido: ${tipo}. Use ${Object.keys(GRUPOS).join(", ")}.` });
    return;
  }

  const url = /^\d+$/.test(n) && Number(n) > 0
    ? `https://markets.newyorkfed.org/api/rates/${grupo}/${tipo}/last/${n}.json`
    : `https://markets.newyorkfed.org/api/rates/${grupo}/${tipo}/search.json?startDate=2000-01-01`;

  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) {
      res.status(r.status).json({ erro: `NY Fed respondeu HTTP ${r.status}` });
      return;
    }
    const dados = await r.json();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=86400");
    res.status(200).json(dados);
  } catch (err) {
    res.status(502).json({ erro: `Falha ao consultar o NY Fed: ${err.message}` });
  }
};
