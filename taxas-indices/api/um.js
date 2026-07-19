// Proxy (Vercel): /api/um?code=236 -> BNDES /Moedas/um236.txt
// O TXT do BNDES não sai com CORS, então o front consome via este proxy.

// fetch + leitura do corpo sob o MESMO deadline. O fetch resolve ao receber os
// cabeçalhos, então o timer precisa seguir ativo enquanto o corpo é consumido —
// um corpo travado prenderia a função até o timeout da Vercel. Retorna { r, body },
// com body já lido (texto) apenas quando a resposta é OK.
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
    const { r, body } = await fetchWithTimeout(`https://www.bndes.gov.br/Moedas/um${code}.txt`, { as: "text" });
    if (!r.ok) {
      res.status(r.status).send(`BNDES respondeu HTTP ${r.status}`);
      return;
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).send(body);
  } catch (err) {
    if (err && err.name === "AbortError") {
      res.status(504).send("Tempo esgotado ao consultar o BNDES.");
      return;
    }
    res.status(502).send(`Falha ao consultar o BNDES: ${err.message}`);
  }
};
