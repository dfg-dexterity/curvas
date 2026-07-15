// Proxy (Vercel): /api/um?code=001 -> BNDES /Moedas/um001.txt
// O TXT do BNDES não sai com CORS, então o front consome via este proxy.
module.exports = async (req, res) => {
  const code = String((req.query && req.query.code) || "").trim().padStart(3, "0");
  if (!/^\d{3}$/.test(code)) {
    res.status(400).send("Parâmetro 'code' inválido (esperado código numérico de até 3 dígitos).");
    return;
  }

  try {
    const r = await fetch(`https://www.bndes.gov.br/Moedas/um${code}.txt`);
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
    res.status(502).send(`Falha ao consultar o BNDES: ${err.message}`);
  }
};
