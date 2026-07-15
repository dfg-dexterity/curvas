// Proxy (Vercel): /api/sgs?codigo=433[&ultimos=13] -> API SGS do Banco Central
// Devolve o JSON do SGS como vem: [{ "data": "DD/MM/AAAA", "valor": "..." }, ...]
module.exports = async (req, res) => {
  const codigo = String((req.query && req.query.codigo) || "").trim();
  const ultimos = String((req.query && req.query.ultimos) || "").trim();
  if (!/^\d+$/.test(codigo)) {
    res.status(400).json({ erro: "Parâmetro 'codigo' inválido (esperado número da série SGS)." });
    return;
  }

  const base = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados`;
  const url = /^\d+$/.test(ultimos) && Number(ultimos) > 0
    ? `${base}/ultimos/${ultimos}?formato=json`
    : `${base}?formato=json`;

  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) {
      res.status(r.status).json({ erro: `SGS respondeu HTTP ${r.status}` });
      return;
    }
    const dados = await r.json();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=86400");
    res.status(200).json(dados);
  } catch (err) {
    res.status(502).json({ erro: `Falha ao consultar o SGS: ${err.message}` });
  }
};
