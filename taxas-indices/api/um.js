// Proxy (Vercel): /api/um?code=236 -> BNDES /Moedas/um236.txt
// O TXT do BNDES não sai com CORS, então o front consome via este proxy.

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
  // Valida o code CRU antes de completar com zeros: sem esse cuidado, um code
  // ausente vira "" -> padStart -> "000" e passaria no regex, disparando um
  // request upstream em vez de responder 400.
  const rawCode = String((req.query && req.query.code) || "").trim();
  if (!/^\d{1,3}$/.test(rawCode)) {
    res.status(400).send("Parâmetro 'code' inválido (esperado código numérico de até 3 dígitos).");
    return;
  }
  const code = rawCode.padStart(3, "0");

  try {
    const r = await fetchWithTimeout(`https://www.bndes.gov.br/Moedas/um${code}.txt`);
    if (!r.ok) {
      res.status(r.status).send(`BNDES respondeu HTTP ${r.status}`);
      return;
    }
    const text = await r.text();
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).send(text);
  } catch (err) {
    if (err && err.name === "AbortError") {
      res.status(504).send("Tempo esgotado ao consultar o BNDES.");
      return;
    }
    res.status(502).send(`Falha ao consultar o BNDES: ${err.message}`);
  }
};
