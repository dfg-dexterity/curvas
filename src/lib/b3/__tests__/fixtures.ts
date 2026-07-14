/**
 * Fixtures baseadas na estrutura da página "Taxas Referenciais BM&F"
 * (lum-taxas-referenciais-bmf-ptBR.asp): tabelas aninhadas, cabeçalho com
 * rowspan/colspan e subcabeçalho contendo apenas os marcadores 252/360.
 */

const SELECT = `
<form name="frm" action="lum-taxas-referenciais-bmf-ptBR.asp" method="get">
  <select name="slcTaxa" id="slcTaxa" class="select">
    <option value="PRE" selected>DI x pr&eacute;</option>
    <option value="DIC">DI x IPCA</option>
    <option value="DIM">DI x IGP-M</option>
    <option value="DOC">Cupom cambial OC1</option>
    <option value="SLP">Selic x pr&eacute;</option>
  </select>
  <input type="text" name="Data" value="15/01/2024">
</form>`

/** Curva com as duas bases (252 e 360), layout com rowspan no cabeçalho. */
export const PAGE_TWO_BASES = `<!DOCTYPE html>
<html><head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">
<title>Taxas Referenciais BM&F</title></head>
<body>
${SELECT}
<table border="0"><tr><td>
  <table id="tb_principal1" cellpadding="2" cellspacing="0">
    <tr>
      <td rowspan="2" class="tabelaItem"><b>DIAS CORRIDOS</b></td>
      <td colspan="2" class="tabelaItem" align="center"><b>DI x pr&eacute;</b></td>
    </tr>
    <tr>
      <td class="tabelaItem" align="center"><b>252</b></td>
      <td class="tabelaItem" align="center"><b>360</b></td>
    </tr>
    <tr><td align="center">3</td><td align="center">10,65</td><td align="center">10,51</td></tr>
    <tr><td align="center">4</td><td align="center">10,66</td><td align="center">10,52</td></tr>
    <tr><td align="center">7</td><td align="center">10,68</td><td align="center">10,54</td></tr>
    <tr><td align="center">1.001</td><td align="center">11,25</td><td align="center">11,09</td></tr>
    <tr><td align="center">3.652</td><td align="center">12,3456</td><td align="center">--</td></tr>
  </table>
</td></tr></table>
<p class="rodape">Taxas em % a.a.</p>
</body></html>`

/** Curva que publica só a base 360 (estilo cupom cambial), com taxa negativa. */
export const PAGE_ONLY_360 = `<!DOCTYPE html>
<html><head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"></head>
<body>
${SELECT}
<table><tr><td>
  <table id="tb_principal1">
    <tr>
      <td rowspan="2"><b>DIAS CORRIDOS</b></td>
      <td align="center"><b>Cupom cambial OC1</b></td>
    </tr>
    <tr><td align="center"><b>360</b></td></tr>
    <tr><td>3</td><td>-0,52</td></tr>
    <tr><td>32</td><td>1,15</td></tr>
    <tr><td>63</td><td>2,08</td></tr>
  </table>
</td></tr></table>
</body></html>`

/** Cabeçalho em linha única (sem rowspan), só base 252. */
export const PAGE_INLINE_HEADER = `<html><body>
${SELECT}
<table id="tb_principal1">
  <tr><td><b>Dias Corridos</b></td><td><b>252</b></td></tr>
  <tr><td>1</td><td>13,15</td></tr>
  <tr><td>22</td><td>13,17</td></tr>
</table>
</body></html>`

/** Data sem publicação (feriado): mensagem oficial, sem tabela. */
export const PAGE_EMPTY = `<html><head><meta charset="iso-8859-1"></head><body>
${SELECT}
<p class="msg">N&atilde;o h&aacute; dados para a data pesquisada.</p>
</body></html>`

/** Página irreconhecível (erro/bloqueio do servidor). */
export const PAGE_GARBAGE = `<html><body><h1>Service Unavailable</h1><p>Try again later.</p></body></html>`
