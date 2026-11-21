/**
 * Leitura do PDF da fatura do cartão:
 *  1) caminho principal: o navegador extrai o texto do PDF com pdf.js (pede a senha quando o PDF tem uma) e envia
 *     só o texto (rota /api/faturas/ler-texto). Plano B (PDF escaneado ou pdf.js indisponível): o PDF é convertido
 *     temporariamente em Google Docs pelo Drive, com OCR — mesmo método do 12_ImportarPdf.js do sistema original.
 *  2) as linhas do texto são analisadas: data + descrição + valor (aceita 2 colunas de lançamentos na mesma linha,
 *     "PARC 03/10", "03/10" ou "3 DE 10" no fim da descrição, valores negativos = estorno/crédito).
 *  3) pagamentos, saldos, totais e limites são ignorados (e listados para conferência).
 * Nada é gravado aqui: o resultado preenche a tela "Lançar vários" para a pessoa conferir e marcar o que é dividido.
 */
var IMP = (function () {
  var MESES = { JAN: 1, FEV: 2, FEB: 2, MAR: 3, ABR: 4, APR: 4, MAI: 5, MAY: 5, JUN: 6, JUL: 7, AGO: 8, AUG: 8, SET: 9, SEP: 9, OUT: 10, OCT: 10, NOV: 11, DEZ: 12, DEC: 12 };
  var NOMES_MES = { JANEIRO: 1, FEVEREIRO: 2, MARCO: 3, ABRIL: 4, MAIO: 5, JUNHO: 6, JULHO: 7, AGOSTO: 8, SETEMBRO: 9, OUTUBRO: 10, NOVEMBRO: 11, DEZEMBRO: 12 };
  function mesDaPalavra(p) { var x = semAcento(p).replace(/\.$/, ''); return MESES[x] || NOMES_MES[x] || 0; }
  // linhas que não são compras. "PAGAMENTO" só no começo: lojas online como "EBANX PAGAMENTOS" ou "PAG*LOJA" são compras.
  var IGNORAR = /^(PAGAMENTO|PAGTO|PGTO|PAG\.? (EFETUADO|RECEBIDO))\b|PAGAMENTO (RECEBIDO|EFETUADO|DA FATURA|DE FATURA)|SALDO|\bTOTAL\b|SUBTOTAL|LIMITE|VENCIMENTO|MINIMO|FATURA ANTERIOR|CREDITO ROTATIVO DISPONIVEL|MELHOR DIA|PROXIMA FATURA|ENCARGOS MAXIMOS|\bCET\b|TAXA DE JUROS|COTACAO DO DOLAR/;
  var VALOR = '(\\d{1,3}(?:\\.\\d{3})+,\\d{2}|\\d+,\\d{2})'; // 1.234,56 ou 1234,56

  function semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase(); }
  function centavos(txt) { return Math.round(Number(String(txt).replace(/\./g, '').replace(',', '.')) * 100); }

  // ---------- 1) PDF → texto (Drive + Docs) ----------
  function extrairTexto(blob) {
    var id = null;
    try {
      var arq = Drive.Files.create({ name: 'tmp_fatura_' + Utilities.getUuid(), mimeType: 'application/vnd.google-apps.document' }, blob, { ocrLanguage: 'pt' });
      id = arq.id;
      var corpo = DocumentApp.openById(id).getBody(), linhas = [];
      var percorrer = function (el) {
        var t = el.getType();
        if (t === DocumentApp.ElementType.TABLE) {
          var tb = el.asTable();
          for (var r = 0; r < tb.getNumRows(); r++) { var row = tb.getRow(r), cels = []; for (var c = 0; c < row.getNumCells(); c++) cels.push(row.getCell(c).getText().replace(/\s+/g, ' ').trim()); linhas.push(cels.join('\t')); }
        } else if (t === DocumentApp.ElementType.PARAGRAPH || t === DocumentApp.ElementType.LIST_ITEM) linhas.push(el.getText());
        else if (el.getNumChildren) { for (var i = 0; i < el.getNumChildren(); i++) percorrer(el.getChild(i)); }
      };
      for (var i = 0; i < corpo.getNumChildren(); i++) percorrer(corpo.getChild(i));
      return linhas.join('\n');
    } finally { if (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* ignora */ } } }
  }

  // ---------- 2) texto → lançamentos ----------
  /** Classifica as palavras de uma linha em DATA / VALOR / texto (juntando "15 OUT", "R$ 10,00", "10,00 -", "10,00 CR"). */
  function tokens(linha) {
    // espaço grande (tab ou 3+ espaços) = troca de coluna: vira o marcador G (o leitor do navegador já usa 3 espaços)
    var w = linha.replace(/\u00a0/g, ' ').replace(/\t| {3,}/g, ' \u0007 ').split(/ +/).filter(Boolean), out = [];
    for (var i = 0; i < w.length; i++) {
      var p = w[i], prox = w[i + 1] ? mesDaPalavra(w[i + 1]) : 0;
      if (p === '\u0007') { if (out.length && out[out.length - 1].t !== 'G') out.push({ t: 'G', s: '' }); continue; }
      var m = /^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/.exec(p);
      if (m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) { out.push({ t: 'D', dia: +m[1], mes: +m[2], ano: m[3] ? +m[3] : null, s: p }); continue; }
      var mx = /^(\d{1,2})[\/.\-]([A-Za-zÇç]{3,9})\.?(?:[\/.\-](\d{2,4}))?$/.exec(p); // 10/OUT, 10-out-2026
      if (mx && mesDaPalavra(mx[2]) && +mx[1] >= 1 && +mx[1] <= 31) { out.push({ t: 'D', dia: +mx[1], mes: mesDaPalavra(mx[2]), ano: mx[3] ? +mx[3] : null, s: p }); continue; }
      if (/^\d{1,2}$/.test(p) && prox && +p >= 1 && +p <= 31) { // "15 OUT" / "15 OUT 2026" / "15 DE OUT"
        var ano = w[i + 2] && /^\d{4}$/.test(w[i + 2]) ? +w[i + 2] : null;
        out.push({ t: 'D', dia: +p, mes: prox, ano: ano, s: p + ' ' + w[i + 1] + (ano ? ' ' + ano : '') }); i += ano ? 2 : 1; continue;
      }
      var neg = false, s = p;
      if (/^([-−]|[-−]?R\$)$/i.test(s) && w[i + 1] && new RegExp('^[-−]?(R\\$)?[-−]?' + VALOR + '[-−]?$', 'i').test(w[i + 1])) { neg = /^[-−]/.test(s); i++; s = w[i]; }
      var v = new RegExp('^([-−])?(R\\$)?([-−])?' + VALOR + '([-−])?$', 'i').exec(s);
      if (v) {
        neg = neg || !!(v[1] || v[3] || v[5]);
        var suf = w[i + 1] ? semAcento(w[i + 1]) : '';
        if (suf === 'CR' || suf === 'C' || suf === '-' || suf === '(-)') { neg = true; i++; } else if (suf === 'D' || suf === 'DB') i++;
        out.push({ t: 'V', c: centavos(v[4]) * (neg ? -1 : 1), s: s }); continue;
      }
      out.push({ t: 'X', s: p });
    }
    return out;
  }
  /** Ano da compra: a compra não pode ser depois do vencimento; parcela k também recua a 1ª fatura. */
  function inferirData(tok, mesFatura, k) {
    var fy = Number(mesFatura.slice(0, 4)), fm = Number(mesFatura.slice(5, 7)), ano = tok.ano;
    if (ano && ano < 100) ano += 2000;
    if (!ano) {
      ano = tok.mes > fm ? fy - 1 : fy;
      var primeira = U.somarMeses(mesFatura, -((k || 1) - 1));
      while (U.difMeses(ano + '-' + U.pad(tok.mes), primeira) < -1) ano--; // 1ª parcela não pode vir antes da compra
    }
    var dia = Math.min(tok.dia, new Date(Date.UTC(ano, tok.mes, 0)).getUTCDate());
    return ano + '-' + U.pad(tok.mes) + '-' + U.pad(dia);
  }
  /** Tira "PARC 03/10", "03/10", "3 DE 10", "PARCELA 3 DE 10" da descrição. */
  function separarParcela(desc) {
    var m = /\s*\b(?:PARC(?:ELA)?S?\.?\s*)(\d{1,2})\s*(?:\/|DE)\s*(\d{1,2})\b/i.exec(desc) || /\s+(\d{1,2})\s*(?:\/|\sDE\s)\s*(\d{1,2})\s*$/i.exec(desc)
      || /(?:\s|(?<=[A-Za-z*.]))(\d{2})\/(\d{2})(?=\s|$)/.exec(desc); // "AMAZON BR 11/12 SAO PAULO", "SISTEMAS06/12"
    if (m) { var k = +m[1], n = +m[2]; if (n >= 2 && n <= 48 && k >= 1 && k <= n) return { desc: (desc.slice(0, m.index) + desc.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim(), k: k, n: n }; }
    return { desc: desc.trim(), k: 1, n: 1 };
  }
  function limparDesc(d) { return d.replace(/^[\-–•*|:]+\s*/, '').replace(/\s*[\-–|:]+$/, '').replace(/\s{2,}/g, ' ').trim(); }

  function analisarTexto(texto, mesFatura) {
    var T = String(texto || ''), up = semAcento(T), venc = null, totalPdf = null;
    // vencimento: a data (dd/mm/aaaa) que mais aparece junto de "vencimento" (na mesma linha ou logo abaixo);
    // faturas trazem também "melhor dia de compra", "pague até…" etc., então vale a mais repetida (a 1ª em caso de empate)
    var conta = {}, ordem = [], reV = /VENCIMENTO(?:[^\n]*\n){0,8}?[^\n]*?\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})\b/g, mv;
    while ((mv = reV.exec(up))) {
      var aa = +mv[3] < 100 ? 2000 + +mv[3] : +mv[3], dv = aa + '-' + U.pad(+mv[2]) + '-' + U.pad(+mv[1]);
      if (+mv[2] >= 1 && +mv[2] <= 12 && +mv[1] >= 1 && +mv[1] <= 31 && aa > 2000) { if (!conta[dv]) ordem.push(dv); conta[dv] = (conta[dv] || 0) + 1; }
      reV.lastIndex = mv.index + 10;
    }
    if (ordem.length) venc = ordem.slice().sort(function (a, b) { return conta[b] - conta[a] || ordem.indexOf(a) - ordem.indexOf(b); })[0];
    else { // "Vencimento: 10 NOV 2026"
      mv = /VENCIMENTO[^0-9]{0,40}(\d{1,2})\s*(?:DE\s+)?([A-Z]{3})[A-Z]*\.?\s*(?:DE\s+)?(\d{4})/.exec(up);
      if (mv) { var mm = mesDaPalavra(mv[2]); if (mm) venc = mv[3] + '-' + U.pad(mm) + '-' + U.pad(+mv[1]); }
    }
    var mt = null; // "total da fatura" vale mais que "total a pagar" (que às vezes é o do parcelamento); o valor pode estar na linha de baixo
    var NUM = '(?:R\\$\\s*)?(\\d{1,3}(?:\\.\\d{3})*,\\d{2})', DAF = 'TOTAL\\s+(?:DA\\s+FATURA|DESTA\\s+FATURA|DA\\s+SUA\\s+FATURA)', APG = 'TOTAL\\s+(?:A\\s+PAGAR|FATURA)';
    [new RegExp(DAF + '[^0-9\\n]{0,80}' + NUM), new RegExp(DAF + '[^\\n]*\\n(?:[^\\n]*\\n){0,3}?[^0-9\\n]*?' + NUM), new RegExp(APG + '[^0-9\\n]{0,80}' + NUM), new RegExp(APG + '[^\\n]*\\n(?:[^\\n]*\\n){0,3}?[^0-9\\n]*?' + NUM)]
      .some(function (re) { mt = re.exec(up); return !!mt; });
    if (mt) totalPdf = centavos(mt[1]) / 100;
    var mes = U.mesValido(mesFatura) ? mesFatura : (venc ? venc.slice(0, 7) : U.mesAtual());
    if (venc && U.mesValido(venc.slice(0, 7))) mes = venc.slice(0, 7);
    var itens = [], ignorados = [], semData = [], antTotal = 0, pend = null, ultimaData = null, secao = '', secoes = {};
    // fim do valor: depois dele só pode vir outra data (2ª coluna) ou o final do cartão ("1234", "final 1234", "•1234")
    var rabo = function (x) { return x.t === 'X' && /^((FINAL|CARTAO|CART[AÃ]O|VIRTUAL|DIGITAL)|[*X•.]*\d{4}|[*X•.]+)$/i.test(semAcento(x.s)); };
    // ...ou, depois de um espaço de coluna, texto de outro quadro (ex.: tabela de juros ao lado dos lançamentos)
    var fechaEm = function (tk, i) {
      var j = i + 1, gap = false; while (j < tk.length && (rabo(tk[j]) || tk[j].t === 'G')) { if (tk[j].t === 'G') gap = true; j++; }
      if (j === tk.length || tk[j].t === 'D') return j;
      return gap && tk[j].t === 'X' ? j : -1;
    };
    var soD = function (tk) { return tk.every(function (x) { return x.t === 'D' || x.t === 'G'; }); };
    /** Descrição = 1º bloco de texto; outros blocos (cidade, valor em US$, cotação) saem, menos o "11/12" da parcela. */
    var montarDesc = function (partes) {
      var segs = [], cur = []; partes.forEach(function (x) { if (x === '\u0007') { if (cur.length) segs.push(cur.join(' ')); cur = []; } else cur.push(x); }); if (cur.length) segs.push(cur.join(' '));
      if (segs.length <= 1) return segs.join('');
      var d = segs[0]; segs.slice(1).forEach(function (sg) { if (/^(PARC(ELA)?\.?\s*)?\d{1,2}\s*(\/|DE)\s*\d{1,2}$/i.test(sg.trim())) d += ' ' + sg.trim(); }); return d;
    };
    T.split(/\r?\n/).forEach(function (linha) {
      var tk = tokens(linha), su = semAcento(linha), temD = tk.some(function (x) { return x.t === 'D'; }), temV = tk.some(function (x) { return x.t === 'V'; });
      // cabeçalho de cartão (titular, adicional, virtual/digital): "Cartão Virtual final 1234", "5502 XXXX XXXX 1234"
      if (!temD && /CARTAO|VIRTUAL|DIGITAL|FINAL|ADICIONAL|TITULAR|XXXX|\*{4}/.test(su)) {
        var fins = su.match(/(?:^|\D)(\d{4})(?!\d)/g);
        if (fins && !temV) { secao = (/VIRTUAL|DIGITAL/.test(su) ? 'virtual ' : '') + 'final ' + fins[fins.length - 1].replace(/\D/g, ''); pend = null; ultimaData = null; return; }
      }
      var atual = null, gerou = false;
      var prim = tk.filter(function (x) { return x.t !== 'G'; })[0];
      if (pend && prim && prim.t === 'V') atual = pend; // o valor caiu na linha de baixo
      pend = null;
      if (!atual && !temD && temV && ultimaData && prim && prim.t === 'X') atual = { data: ultimaData, partes: [], herdada: true }; // várias compras sob a mesma data
      for (var i = 0; i < tk.length; i++) {
        var x = tk[i];
        if (!atual) { if (x.t === 'D') atual = { data: x, partes: [] }; continue; }
        var ate = x.t === 'V' ? fechaEm(tk, i) : -1;
        if (ate < 0) { if (x.t === 'G') { if (atual.partes.length) atual.partes.push('\u0007'); } else if (x.t === 'D' && !atual.partes.length) atual.data = x; else atual.partes.push(x.s); continue; } // 2 datas seguidas: compra + lançamento
        var bruto = montarDesc(atual.partes);
        if (/^(A|ATE|À)\s+\d{1,2}\/\d{1,2}/i.test(semAcento(bruto))) { atual = null; i = ate - 1; continue; } // período ("05/05/26 a 02/06/26"), não é compra
        while (/^\d{1,2}[\/.]\d{1,2}(?:[\/.]\d{2,4})?\s/.test(bruto)) bruto = bruto.replace(/^\S+\s/, ''); // 2ª coluna de data (lançamento)
        var p = separarParcela(limparDesc(bruto)), desc = limparDesc(p.desc);
        if (desc.length < 2 || !/[A-Za-zÀ-ú]/.test(desc) || !x.c) { atual = null; i = ate - 1; continue; }
        var reg = { data_compra: inferirData(atual.data, mes, p.k), descricao: desc.slice(0, 120), valor_parcela: x.c / 100, parcela_atual: p.k, parcelas: p.n };
        if (secao) reg.cartao_secao = secao;
        if (IGNORAR.test(semAcento(desc))) ignorados.push({ descricao: desc, valor: x.c / 100, motivo: 'pagamento, saldo ou total' });
        else { itens.push(reg); gerou = true; var sk = secao || 'principal'; secoes[sk] = secoes[sk] || { nome: secao || 'cartão principal', itens: 0, soma: 0 }; secoes[sk].itens++; secoes[sk].soma += x.c; }
        ultimaData = atual.herdada ? atual.data : null; atual = null; i = ate - 1;
      }
      if (atual && !atual.herdada) { if (atual.partes.length) pend = atual; else if (soD(tk)) ultimaData = atual.data; } // só a data na linha: as compras vêm embaixo
      else if (!gerou && !temD && !temV && tk.length) ultimaData = null;
      var nV = tk.filter(function (x) { return x.t === 'V'; }).length, txt = tk.filter(function (x) { return x.t === 'X'; }).map(function (x) { return x.s; }).join(' ');
      var eraTotal = antTotal > 0; antTotal = /^\s*TOTAL\b/.test(su) ? 3 : antTotal - 1; // "Total para FULANO DE" + "TAL 6,92" logo abaixo
      if (!gerou && !eraTotal && nV === 1 && !temD && !(atual && atual.herdada) && /[A-Za-z]{3}/.test(txt) && !/[%:]|\.{3}|R\$/.test(linha) && semData.length < 40) {
        var vv = tk.filter(function (x) { return x.t === 'V'; }).pop(); if (!IGNORAR.test(su)) semData.push({ descricao: linha.replace(/\s+/g, ' ').trim().slice(0, 120), valor: vv.c / 100, motivo: 'linha com valor e sem data' });
      }
    });
    var soma = itens.reduce(function (s, it) { return s + Math.round(it.valor_parcela * 100); }, 0) / 100;
    var listaSec = Object.keys(secoes).map(function (k) { return { nome: secoes[k].nome, itens: secoes[k].itens, soma: U.reais(secoes[k].soma) }; });
    return { mes: mes, vencimento: venc, total_pdf: totalPdf, soma_itens: Math.round(soma * 100) / 100, itens: itens, ignorados: ignorados, sem_data: semData, cartoes: listaSec };
  }

  /** Marca os itens que já estão lançados nesta fatura (mesma descrição, parcela e valor). */
  function marcarDuplicados(r, cartaoId) {
    if (!cartaoId || !D.porId('cartoes', cartaoId)) return r;
    var ja = {}, chave = function (d, k, n, v) { return semAcento(d).replace(/[^A-Z0-9]/g, '') + '|' + k + '/' + n + '|' + Math.round(v * 100); };
    R.faturaDetalhe(cartaoId, r.mes, '').itens.forEach(function (i) { ja[chave(i.descricao, i.parcela, i.parcelas, i.valor)] = 1; });
    r.itens.forEach(function (it) { if (ja[chave(it.descricao, it.parcela_atual, it.parcelas, it.valor_parcela)]) it.duplicado = true; });
    return r;
  }
  /** Caminho principal: o navegador já extraiu o texto do PDF (pdf.js, inclusive de PDF com senha). */
  function lerTexto(texto, mesFatura, cartaoId) {
    texto = String(texto || ''); if (texto.length > 600000) throw erro_(413, 'Texto grande demais.');
    if (texto.replace(/\s/g, '').length < 20) throw erro_(422, 'Não encontrei texto neste PDF (pode ser uma imagem escaneada).', { codigo: 'SEM_TEXTO' });
    var r = marcarDuplicados(analisarTexto(texto, mesFatura), cartaoId);
    if (!r.itens.length) r.aviso = 'Li o PDF, mas não reconheci lançamentos (data, descrição e valor na mesma linha). Lance à mão ou me envie um exemplo para ajustar a leitura.';
    return r;
  }
  /** Plano B: o PDF vai para o Google (Drive + Docs, com OCR). Não abre PDF com senha. */
  function lerPdf(b64, mesFatura, cartaoId) {
    var bytes = Utilities.base64Decode(b64);
    if (!bytes.length || !(bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70)) throw erro_(400, 'O arquivo enviado não é um PDF.');
    if (bytes.length > 2 * 1024 * 1024) throw erro_(413, 'PDF grande demais para leitura pelo Google (limite de 2 MB).');
    if (Utilities.newBlob(bytes).getDataAsString('ISO-8859-1').indexOf('/Encrypt') >= 0) throw erro_(422, 'Este PDF tem senha e a leitura pelo Google não abre arquivos com senha.', { codigo: 'SENHA' });
    var texto;
    try { texto = extrairTexto(Utilities.newBlob(bytes, 'application/pdf', 'fatura.pdf')); }
    catch (e) {
      var det = String(e && e.message || e); console.error('PDF: ' + det);
      if (/Drive is not defined|Drive não está definido|ReferenceError/i.test(det)) throw erro_(500, 'O serviço "Drive API" não está ativado no projeto do Apps Script. No editor: Serviços (+) → Drive API → Adicionar; depois execute instalar().', { codigo: 'DRIVE' });
      if (/authoriz|autoriza|permission|permiss|scope/i.test(det)) throw erro_(500, 'Falta autorizar o acesso ao Drive/Docs: no editor do Apps Script, execute instalar() e aceite as permissões. Depois publique uma nova versão.', { codigo: 'AUTORIZAR' });
      throw erro_(422, 'O Google não conseguiu ler este PDF (' + det.slice(0, 160) + ').', { codigo: 'FALHA' });
    }
    return lerTexto(texto, mesFatura, cartaoId);
  }
  return { lerPdf: lerPdf, lerTexto: lerTexto, analisarTexto: analisarTexto, tokens: tokens, separarParcela: separarParcela };
})();
