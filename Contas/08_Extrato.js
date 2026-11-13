/**
 * Importar extrato bancário (OFX ou CSV) para lançar pix/débito de uma vez.
 *  • Só entram SAÍDAS (valores negativos / débitos). Entradas, pagamento de fatura do cartão, aplicações e
 *    transferências entre contas próprias vêm desmarcadas (o cartão já é contado pela fatura).
 *  • Forma (Pix / Débito / Dinheiro) e categoria são sugeridas pela descrição; se você já lançou algo com a mesma
 *    descrição, repete a categoria e a divisão que usou da última vez.
 *  • Cada linha guarda uma referência (ref_externa) para não ser importada duas vezes.
 */
var EXT = (function () {
  var MAX_TEXTO = 3e6;

  function norm(s) { return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); }
  function chaveDesc(s) { return norm(s).replace(/[0-9]{2}\/[0-9]{2}(\/[0-9]{2,4})?/g, '').replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function hashCurto(s) { var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8); return b.slice(0, 9).map(function (x) { return ((x + 256) % 256).toString(16); }).join(''); }

  /** "1.234,56" | "-1234.56" | "R$ 50,00" | "(50,00)" → centavos (com sinal) */
  function valorBr(s) {
    s = String(s == null ? '' : s).trim(); if (!s) return NaN;
    var neg = /^-|^\(.*\)$|-$|\bD$/i.test(s.replace(/\s/g, ''));
    s = s.replace(/[^0-9.,]/g, ''); if (!s) return NaN;
    var ult = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
    var inteiro, dec = '';
    if (ult >= 0 && s.length - ult - 1 <= 2) { inteiro = s.slice(0, ult); dec = s.slice(ult + 1); } else inteiro = s;
    inteiro = inteiro.replace(/[.,]/g, ''); dec = (dec + '00').slice(0, 2);
    var c = Number(inteiro || '0') * 100 + Number(dec); return neg ? -c : c;
  }
  /** dd/mm/aaaa, dd/mm/aa, aaaa-mm-dd, aaaammdd → AAAA-MM-DD */
  function dataBr(s) {
    s = String(s || '').trim(); var m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return m[1] + '-' + m[2] + '-' + m[3];
    if ((m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/.exec(s))) { var a = m[3].length === 2 ? '20' + m[3] : m[3]; return a + '-' + U.pad(+m[2]) + '-' + U.pad(+m[1]); }
    if ((m = /^(\d{4})(\d{2})(\d{2})/.exec(s))) return m[1] + '-' + m[2] + '-' + m[3];
    return '';
  }

  // ---------- OFX ----------
  function tag(bloco, nome) { var m = new RegExp('<' + nome + '>([^<\\r\\n]*)', 'i').exec(bloco); return m ? m[1].trim() : ''; }
  function lerOfx(t) {
    var out = [], re = /<STMTTRN>([\s\S]*?)(<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>))/gi, m;
    while ((m = re.exec(t))) {
      var b = m[1], amt = tag(b, 'TRNAMT').replace(',', '.'), c = Math.round(Number(amt) * 100);
      var desc = [tag(b, 'NAME'), tag(b, 'MEMO')].filter(Boolean); if (desc.length === 2 && norm(desc[1]).indexOf(norm(desc[0])) >= 0) desc = [desc[1]];
      out.push({ data: dataBr(tag(b, 'DTPOSTED')), descricao: desc.join(' — '), c: c, tipo: tag(b, 'TRNTYPE').toUpperCase(), ref: tag(b, 'FITID') });
    }
    return out;
  }

  // ---------- CSV ----------
  function dividir(linha, sep) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < linha.length; i++) {
      var ch = linha[i];
      if (q) { if (ch === '"') { if (linha[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true; else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur); return out.map(function (x) { return x.trim(); });
  }
  function lerCsv(t) {
    var linhas = t.split(/\r?\n/).filter(function (l) { return l.trim(); }); if (!linhas.length) return [];
    var amostra = linhas.slice(0, 15).join('\n'), sep = [';', ',', '\t'].sort(function (a, b) { return amostra.split(b).length - amostra.split(a).length; })[0];
    // cabeçalho: primeira linha que tenha "data" e ("valor" ou "débito")
    var hi = -1, cab = null;
    for (var i = 0; i < Math.min(linhas.length, 30); i++) { var cs = dividir(linhas[i], sep).map(norm); if (cs.some(function (c) { return /DATA/.test(c); }) && cs.some(function (c) { return /VALOR|DEBITO|SAIDA|QUANTIA|MONTANTE/.test(c); })) { hi = i; cab = cs; break; } }
    var iData, iDesc = [], iValor = -1, iDeb = -1, iCred = -1, iTipo = -1, iId = -1;
    if (cab) {
      cab.forEach(function (c, k) {
        if (iData === undefined && /^DATA/.test(c) && !/SALDO/.test(c)) iData = k;
        else if (/HISTORICO|DESCRI|LANCAMENTO|DETALHE|ESTABELECIMENTO|MEMO|TITULO/.test(c) && !/DATA|TIPO/.test(c)) iDesc.push(k);
        else if (/^VALOR|QUANTIA|MONTANTE/.test(c) && iValor < 0) iValor = k;
        else if (/DEBITO|SAIDA/.test(c) && iDeb < 0) iDeb = k;
        else if (/CREDITO|ENTRADA/.test(c) && iCred < 0) iCred = k;
        else if (/TIPO|D\/C|NATUREZA/.test(c) && iTipo < 0) iTipo = k;
        else if (/IDENTIFICADOR|DOCUMENTO|^ID$|^N/.test(c) && iId < 0) iId = k;
      });
    }
    if (iData === undefined) { iData = 0; iDesc = [1]; iValor = 2; hi = -1; } // sem cabeçalho: data; descrição; valor
    var out = [];
    linhas.slice(hi + 1).forEach(function (l) {
      var cs = dividir(l, sep), data = dataBr(cs[iData]); if (!data) return;
      var c;
      if (iValor >= 0) { c = valorBr(cs[iValor]); if (iTipo >= 0 && /^D|DEB|SAIDA/.test(norm(cs[iTipo])) && c > 0) c = -c; }
      else { var d = valorBr(cs[iDeb]), cr = valorBr(cs[iCred]); c = !isNaN(d) && d !== 0 ? -Math.abs(d) : (!isNaN(cr) ? Math.abs(cr) : NaN); }
      if (isNaN(c)) return;
      var desc = iDesc.map(function (k) { return cs[k]; }).filter(Boolean).join(' — ');
      if (/SALDO/.test(norm(desc)) && /^SALDO|SALDO (DO DIA|ANTERIOR|FINAL)/.test(norm(desc))) return;
      out.push({ data: data, descricao: desc, c: c, tipo: '', ref: iId >= 0 ? cs[iId] : '' });
    });
    return out;
  }

  // ---------- sugestões ----------
  var CATS = [
    [/IFOOD|RAPPI|RESTAUR|LANCHON|PIZZ|BURGER|BURGUER|MC ?DONALD|BK |SUSHI|PADARIA|CAFE|BAR |CHURRASC|OUTBACK|COCO BAMBU|DELIVERY|ACAI/, 'Restaurante / delivery'],
    [/SUPERMERC|MERCADO|ATACAD|ASSAI|CARREFOUR|PAO DE ACUCAR|EXTRA |BOMPRECO|ATACADAO|HORTIFRUTI|FEIRA|MERCADINHO|SAMS CLUB/, 'Mercado'],
    [/UBER|99 ?APP|99 ?POP|99TAXI|CABIFY|POSTO|COMBUST|SHELL|IPIRANGA|PETROBRAS|BR MANIA|ESTACIONA|PEDAGIO|SEM PARAR|CONECTCAR|VELOE|METRO|ONIBUS/, 'Transporte'],
    [/FARMAC|DROGA|PAGUE MENOS|RAIA|PANVEL|HOSPITAL|CLINIC|LABORAT|ODONTO|UNIMED|HAPVIDA|AMIL|BRADESCO SAUDE|SULAMERICA|MEDIC/, 'Saúde'],
    [/NEOENERGIA|CELPE|ENEL|CEMIG|COPEL|LIGHT|COMPESA|SABESP|CAGECE|EMBASA|CONDOMIN|ALUGUEL|IPTU|GAS |INTERNET|CLARO|VIVO|TIM |OI |NET |SKY|BOLETO/, 'Contas fixas'],
    [/NETFLIX|SPOTIFY|PRIME VIDEO|AMAZON PRIME|DISNEY|HBO|MAX |GLOBOPLAY|YOUTUBE|DEEZER|APPLE\.COM|ICLOUD|GOOGLE ONE|PARAMOUNT|CRUNCHYROLL/, 'Assinaturas'],
    [/PET ?SHOP|PETZ|COBASI|VETERIN|RACAO/, 'Pets'],
    [/ESCOLA|COLEGIO|CURSO|FACULD|UNIVERS|LIVRARIA|UDEMY|ALURA/, 'Educação'],
    [/CINEMA|INGRESSO|SYMPLA|EVENTIM|SHOW|TEATRO|PARQUE/, 'Lazer'],
    [/RENNER|RIACHUELO|C ?& ?A|ZARA|HERING|CENTAUR|NETSHOES|CALCAD|ROUPA/, 'Vestuário'],
    [/HOTEL|POUSADA|AIRBNB|BOOKING|DECOLAR|LATAM|GOL |AZUL |PASSAGEM/, 'Viagem'],
    [/LEROY|TELHA NORTE|CASA ?& ?CONST|MAGAZINE|MAGALU|CASAS BAHIA|TOK ?STOK|ETNA|FERRAGEM|MATERIAL DE CONST/, 'Casa']
  ];
  var IGNORAR = [
    [/PAGAMENTO? (DE )?FATURA|PAG(TO)? ?FATURA|PAGTO CARTAO|PAG(AMENTO)? CARTAO|FATURA CARTAO|CARTAO DE CREDITO|NU PAGAMENTOS.*FATURA/, 'Pagamento da fatura do cartão (as compras já estão na fatura)'],
    [/APLICACAO|APLIC\b|RESGATE|INVEST|CDB|TESOURO|POUPANCA|CAIXINHA|COFRINHO|PORQUINHO|RDB/, 'Aplicação / investimento'],
    [/TRANSF(ERENCIA)? (ENTRE|P\/) CONTAS|MESMA TITULARIDADE|ENTRE CONTAS PROPRIAS/, 'Transferência entre suas contas'],
    [/ESTORNO|DEVOLUCAO/, 'Estorno']
  ];
  function forma(desc, tipo) {
    var d = norm(desc);
    if (/\bPIX\b/.test(d)) return 'PIX';
    if (/SAQUE|ATM|24 ?HORAS/.test(d) || tipo === 'ATM' || tipo === 'CASH') return 'DINHEIRO';
    if (/DEBITO|COMPRA|CARTAO|ELO|VISA|MAESTRO|POS\b/.test(d) || tipo === 'POS') return 'DEBITO';
    if (/TED|DOC|TRANSF|BOLETO|PAGAMENTO|PAGTO/.test(d) || tipo === 'XFER' || tipo === 'PAYMENT') return 'PIX';
    return 'DEBITO';
  }
  /** Tira prefixos genéricos do banco ("Pix enviado -", "Compra no débito -") para a descrição ficar legível. */
  function limparDesc(d) {
    var s = String(d || '').replace(/\s+/g, ' ').trim();
    s = s.replace(/^(transfer[eê]ncia |transf\.? )?(pix )?(enviad[oa] pelo pix|enviad[oa])\s*[-–—:]?\s*/i, '').replace(/^compra (no |com )?(cart[aã]o de )?d[eé]bito\s*[-–—:]?\s*/i, '').replace(/^pagamento de boleto\s*[-–—:]?\s*/i, 'Boleto ');
    s = s.replace(/\s*[-–—]\s*•{3}\.[\d.]+-•{2}\s*/g, ' ').replace(/ — $/, '').trim();
    return (s || String(d || '')).slice(0, 120);
  }

  function analisar(texto, nome, perfil) {
    texto = String(texto || ''); if (!texto.trim()) throw erro_(400, 'O arquivo está vazio.');
    if (texto.length > MAX_TEXTO) throw erro_(413, 'Arquivo grande demais. Exporte um período menor (ex.: um mês).');
    var ofx = /<OFX>|OFXHEADER|<STMTTRN>/i.test(texto), brutos = ofx ? lerOfx(texto) : lerCsv(texto);
    if (!brutos.length) throw erro_(422, ofx ? 'Não achei lançamentos neste OFX.' : 'Não reconheci as colunas deste CSV. O arquivo precisa ter colunas de data, descrição e valor (ou débito/crédito).', { codigo: 'FORMATO' });
    // histórico do próprio usuário: descrição → última categoria/divisão usadas
    var hist = {}, refs = {}, assinaturas = {};
    D.todos('gastos').filter(function (g) { return g.pago_por === perfil.email; }).sort(function (a, b) { return String(a.data).localeCompare(String(b.data)); }).forEach(function (g) {
      var k = chaveDesc(g.descricao); if (k) hist[k] = { categoria: g.categoria || '', divisao: g.divisao };
      if (g.ref_externa) refs[g.ref_externa] = g.id;
      assinaturas[g.data + '|' + U.centavos(g.valor)] = (assinaturas[g.data + '|' + U.centavos(g.valor)] || []).concat([g]);
    });
    var itens = [], ignorados = [], entradas = 0, vistos = {};
    brutos.forEach(function (b, i) {
      if (!b.data || !b.c) return;
      if (b.c > 0) { entradas++; return; }
      var c = -b.c, ref = (ofx ? 'OFX:' : 'CSV:') + (b.ref ? b.ref + ':' + b.data + ':' + c : hashCurto(b.data + '|' + c + '|' + norm(b.descricao)));
      vistos[ref] = (vistos[ref] || 0) + 1; if (vistos[ref] > 1) ref += '#' + vistos[ref]; // dois lançamentos iguais no mesmo dia
      var d = norm(b.descricao), ign = IGNORAR.filter(function (x) { return x[0].test(d); })[0];
      var desc = limparDesc(b.descricao), h = hist[chaveDesc(desc)] || hist[chaveDesc(b.descricao)];
      var cat = h && h.categoria ? h.categoria : ((CATS.filter(function (x) { return x[0].test(d); })[0] || [])[1] || '');
      var dup = refs[ref] ? { id: refs[ref], motivo: 'já importado' } : null;
      if (!dup) { var sim = (assinaturas[b.data + '|' + c] || [])[0]; if (sim) dup = { id: sim.id, motivo: 'já existe um gasto de mesmo valor neste dia (' + sim.descricao + ')' }; }
      var it = { n: i + 1, data: b.data, descricao: desc, original: b.descricao, valor: U.reais(c), forma: forma(b.descricao, b.tipo), categoria: cat, divisao: h ? h.divisao : 'INDIVIDUAL', ref_externa: ref,
        marcar: !ign && !dup, aviso: ign ? ign[1] : dup ? 'Possível repetido: ' + dup.motivo : '', duplicado: dup ? dup.id : '' };
      itens.push(it);
    });
    itens.sort(function (a, b) { return a.data.localeCompare(b.data) || a.n - b.n; });
    var datas = itens.map(function (x) { return x.data; });
    return { formato: ofx ? 'OFX' : 'CSV', arquivo: U.texto(nome, 120), itens: itens, entradas_ignoradas: entradas, de: datas[0] || '', ate: datas[datas.length - 1] || '',
      total_marcado: U.reais(itens.filter(function (x) { return x.marcar; }).reduce(function (s, x) { return s + U.centavos(x.valor); }, 0)), ignorados: ignorados };
  }

  /** Valida e grava vários gastos de uma vez (todos ou nenhum). */
  function lancar(body, perfil) {
    var lista = Array.isArray(body && body.itens) ? body.itens : []; if (!lista.length) throw erro_(400, 'Marque pelo menos um lançamento.');
    if (lista.length > 500) throw erro_(400, 'No máximo 500 lançamentos por vez.');
    var refs = {}; D.todos('gastos').forEach(function (g) { if (g.ref_externa) refs[g.ref_externa] = 1; });
    var agora = D.agoraISO(), pular = 0, out = [];
    lista.forEach(function (b, i) {
      var ref = U.texto(b.ref_externa, 120); if (ref && refs[ref]) { pular++; return; }
      var v; try { v = R.validarGasto(b); } catch (e) { throw erro_(400, 'Linha ' + (i + 1) + ' (' + U.texto(b.descricao, 40) + '): ' + e.message); }
      v.ref_externa = ref; v.pago_por = perfil.email; v.criado_por = perfil.email; v.criado_em = agora; if (ref) refs[ref] = 1; out.push(v);
    });
    out.forEach(function (v) { v.id = D.proximoId('GAS', 6); });
    if (out.length) D.inserirVarios('gastos', out);
    D.auditar(perfil.email, 'Importou ' + out.length + ' gastos do extrato', 'gastos', out.map(function (v) { return v.id; }).join(',').slice(0, 900), { arquivo: U.texto(body.arquivo, 120), pulados: pular });
    return { ok: true, n: out.length, pulados: pular, total: U.reais(out.reduce(function (s, v) { return s + U.centavos(v.valor); }, 0)) };
  }
  return { analisar: analisar, lancar: lancar, valorBr: valorBr, dataBr: dataBr, lerCsv: lerCsv, lerOfx: lerOfx };
})();
