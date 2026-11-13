/**
 * Camada de dados: Google Planilhas como banco (uma aba por tabela, linha 1 = cabeçalho).
 *  • Todas as colunas de texto usam formato "texto simples" (@): datas ISO (AAAA-MM-DD) e meses (AAAA-MM)
 *    nunca são convertidos pela planilha.
 *  • Leituras usam cache (CacheService, em blocos) com versão por tabela; gravações incrementam a versão.
 *  • Gravações devem ocorrer sob LockService (feito pelo roteador em 01_Web.js).
 */
var D = (function () {
  var ESQ = {
    usuarios:  { aba: 'USUARIOS',  cols: 'email:s nome:s ativo:n criado_em:s ultimo_acesso:s' },
    // cartões de crédito: cada cartão tem um titular (quem paga a fatura). Fatura identificada pelo mês de VENCIMENTO.
    cartoes:   { aba: 'CARTOES',   cols: 'id:s titular:s nome:s final:s dia_fechamento:n dia_vencimento:n ativo:n criado_em:s', cache: 1 },
    // compras no cartão (à vista = 1 parcela). As parcelas são calculadas: parcela k cai na fatura primeira_fatura + (k − 1).
    // divisao: INDIVIDUAL (só de quem pagou) | DIVIDIDO (meio a meio) | OUTRO (todo do(a) parceiro(a))
    // terceiro: alguém de fora do casal (mãe, amigo…) que paga terceiro_valor (total) dessa compra; só o resto entra na divisão do casal
    compras:   { aba: 'COMPRAS_CARTAO', cols: 'id:s cartao_id:s descricao:s categoria:s data_compra:s valor_total:n parcelas:n primeira_fatura:s divisao:s obs:s criado_por:s criado_em:s atualizado_por:s atualizado_em:s terceiro:s terceiro_valor:n terceiro_recebido:n', cache: 1, novasNoFim: 1 },
    faturas:   { aba: 'FATURAS',   cols: 'id:s cartao_id:s mes:s paga:n paga_em:s paga_por:s' },
    // gastos em pix / débito / dinheiro: pago_por = quem lançou (quem pagou)
    gastos:    { aba: 'GASTOS_PIX_DEBITO', cols: 'id:s data:s descricao:s categoria:s forma:s valor:n pago_por:s divisao:s obs:s criado_por:s criado_em:s atualizado_por:s atualizado_em:s ref_externa:s', cache: 1, novasNoFim: 1 },
    // gastos fixos (recorrentes): entram todo mês de inicio até fim (vazio = sem fim). tipo CARTAO (na fatura do cartão) ou PIX (pix/débito/dinheiro)
    recorrentes: { aba: 'RECORRENTES', cols: 'id:s tipo:s cartao_id:s forma:s dono:s descricao:s categoria:s valor:n dia:n divisao:s inicio:s fim:s obs:s criado_por:s criado_em:s atualizado_por:s atualizado_em:s', cache: 1 },
    // ganhos de cada pessoa: FIXA (todo mês de inicio até fim, ex.: salário) ou AVULSA (só no mês de inicio, ex.: 13º, freela)
    rendas:    { aba: 'GANHOS',    cols: 'id:s pessoa:s descricao:s tipo:s valor:n dia:n inicio:s fim:s obs:s criado_por:s criado_em:s atualizado_por:s atualizado_em:s', cache: 1 },
    // metas de economia (viagem, carro…) e os depósitos feitos para cada uma (retirada = valor negativo)
    metas:     { aba: 'METAS',     cols: 'id:s nome:s categoria:s valor_alvo:n valor_inicial:n mes_alvo:s rendimento_mes:n pessoa1:s pct1:n ativa:n concluida_em:s obs:s criado_por:s criado_em:s atualizado_por:s atualizado_em:s', cache: 1 },
    aportes:   { aba: 'META_APORTES', cols: 'id:s meta_id:s data:s valor:n quem:s obs:s criado_por:s criado_em:s', cache: 1 },
    // acertos: pagamentos feitos entre o casal para zerar o saldo de um mês
    acertos:   { aba: 'ACERTOS',   cols: 'id:s mes:s de:s para:s valor:n data:s obs:s criado_por:s criado_em:s' },
    // limites (tetos) mensais por categoria, de cada pessoa — comparados com a "sua parte" dos gastos
    limites:   { aba: 'LIMITES',   cols: 'id:s dono:s categoria:s valor:n obs:s criado_em:s atualizado_em:s', cache: 1 },
    auditoria: { aba: 'AUDITORIA', cols: 'id:n quando:s usuario:s acao:s entidade:s entidade_id:s detalhe:s' },
    config:    { aba: 'CONFIG',    cols: 'chave:s valor:s' }
  };
  Object.keys(ESQ).forEach(function (k) {
    var e = ESQ[k]; e.nomes = []; e.tipos = [];
    e.cols.split(' ').forEach(function (c) { var p = c.split(':'); e.nomes.push(p[0]); e.tipos.push(p[1]); });
  });
  var CACHE_TTL = 600, BLOCO = 30000;
  var memo = {}, mapas = {}, versoes = {}, ss = null, pend = [], geracao = 0;

  function props() { return PropertiesService.getScriptProperties(); }
  function planilha() {
    if (ss) return ss;
    var id = props().getProperty('PLANILHA_ID');
    if (!id) throw erro_(503, 'A planilha de dados ainda não foi criada. Execute a função instalar() no editor do Apps Script.');
    ss = SpreadsheetApp.openById(id); return ss;
  }
  function aba(nome) {
    var e = ESQ[nome]; if (!e) throw new Error('Tabela desconhecida: ' + nome);
    var sh = planilha().getSheetByName(e.aba);
    if (!sh) { // tabela nova numa versão do app: cria a aba com o cabeçalho (não mexe nas outras)
      sh = planilha().insertSheet(e.aba); if (sh.getMaxColumns() < e.nomes.length) sh.insertColumnsAfter(sh.getMaxColumns(), e.nomes.length - sh.getMaxColumns());
      sh.getRange(1, 1, 1, e.nomes.length).setNumberFormat('@').setValues([e.nomes]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#334155'); sh.setFrozenRows(1);
      formatarTexto(sh, nome, 2, sh.getMaxRows() - 1);
    }
    return sh;
  }
  /** 'b' = ativo/inativo: aceita 1/0 e Sim/Não; vazio conta como ativo. */
  function ativoDe(v) {
    var t = String(v == null ? '' : v).trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (t === '' || t === '1' || t === 'SIM' || t === 'S' || t === 'TRUE' || t === 'VERDADEIRO' || t === 'ATIVO' || t === 'ATIVA') return 1;
    return 0;
  }
  function conv(v, t) {
    if (t === 'b') return ativoDe(v);
    if (v instanceof Date) v = Utilities.formatDate(v, APP.TZ, 'yyyy-MM-dd');
    if (v === '' || v == null) return null;
    if (t === 'n') { var x = Number(v); return isNaN(x) ? null : x; }
    return String(v);
  }
  function versao(nome) { if (versoes[nome] === undefined) versoes[nome] = props().getProperty('V_' + nome) || '0'; return versoes[nome]; }
  function bump(nome) {
    var v = Date.now() + '-' + Math.random().toString(36).slice(2, 8); versoes[nome] = v; props().setProperty('V_' + nome, v);
    delete memo[nome]; delete mapas[nome]; geracao++;
  }
  function cacheLer(chave) {
    try {
      var c = CacheService.getScriptCache(), n = Number(c.get(chave + '_n')); if (!n) return null;
      var ks = []; for (var i = 0; i < n; i++) ks.push(chave + '_' + i);
      var m = c.getAll(ks), partes = [];
      for (var j = 0; j < n; j++) { if (m[ks[j]] == null) return null; partes.push(m[ks[j]]); }
      return JSON.parse(partes.join(''));
    } catch (e) { return null; }
  }
  function cacheGravar(chave, obj) {
    try {
      var s = JSON.stringify(obj), n = Math.ceil(s.length / BLOCO) || 1, o = {};
      for (var i = 0; i < n; i++) o[chave + '_' + i] = s.substr(i * BLOCO, BLOCO);
      o[chave + '_n'] = String(n);
      CacheService.getScriptCache().putAll(o, CACHE_TTL);
    } catch (e) { /* cache é só otimização */ }
  }
  function lerAba(nome) {
    var e = ESQ[nome], sh = aba(nome), n = sh.getLastRow(); if (n < 2) return [];
    var nc = Math.min(e.nomes.length, sh.getMaxColumns()); // tolera aba com menos colunas (colunas novas ficam vazias)
    var vals = sh.getRange(2, 1, n - 1, nc).getValues(), out = [];
    for (var i = 0; i < vals.length; i++) {
      var row = vals[i]; if (row[0] === '' || row[0] == null) continue;
      var o = { _r: i + 2 };
      for (var j = 0; j < e.nomes.length; j++) o[e.nomes[j]] = conv(row[j], e.tipos[j]);
      out.push(o);
    }
    return out;
  }
  /** Todas as linhas da tabela (objetos). Não altere os objetos diretamente: use atualizar(). */
  function todos(nome) {
    if (memo[nome]) return memo[nome];
    var e = ESQ[nome], r = null, chave = 'db_' + nome + '_' + versao(nome);
    if (e.cache) r = cacheLer(chave);
    if (!r) { r = lerAba(nome); if (e.cache) cacheGravar(chave, r); }
    memo[nome] = r; return r;
  }
  function mapa(nome) {
    if (mapas[nome]) return mapas[nome];
    var chave = ESQ[nome].nomes[0], m = {}; todos(nome).forEach(function (o) { m[o[chave]] = o; }); mapas[nome] = m; return m;
  }
  function porId(nome, id) { return mapa(nome)[id] || null; }
  function paraLinha(nome, o) {
    var e = ESQ[nome];
    return e.nomes.map(function (c, i) {
      var v = o[c]; if (v === undefined || v === null) return '';
      if ((e.tipos[i] === 'n' || e.tipos[i] === 'b') && typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v); // número de verdade na planilha
      return v;
    });
  }
  var cabOk = {};
  /** Bancos criados antes de uma coluna nova no fim ganham o cabeçalho que falta (tabelas com novasNoFim). Nunca mexe em dados. */
  function garantirCabecalho(nome, shOpc) {
    var e = ESQ[nome]; if (!e || !e.novasNoFim || cabOk[nome]) return; cabOk[nome] = true;
    var sh = shOpc || aba(nome), n = e.nomes.length;
    if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
    var atual = sh.getRange(1, 1, 1, n).getValues()[0];
    for (var i = 0; i < n; i++) if (String(atual[i] == null ? '' : atual[i]).trim() === '') sh.getRange(1, i + 1).setValue(e.nomes[i]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#334155');
  }
  function garantirLinhas(sh, ate) { var max = sh.getMaxRows(); if (ate > max) sh.insertRowsAfter(max, Math.max(ate - max, 300)); }
  function inserirVarios(nome, objs) {
    if (!objs.length) return [];
    var e = ESQ[nome], sh = aba(nome), ini = Math.max(sh.getLastRow(), 1) + 1; garantirCabecalho(nome, sh);
    garantirLinhas(sh, ini + objs.length - 1);
    var rng = sh.getRange(ini, 1, objs.length, e.nomes.length);
    formatarTexto(sh, nome, ini, objs.length); rng.setValues(objs.map(function (o) { return paraLinha(nome, o); }));
    objs.forEach(function (o, i) { o._r = ini + i; });
    var tinha = memo[nome]; bump(nome); // invalida cache compartilhado e memória
    if (tinha) { memo[nome] = tinha.concat(objs); }
    return objs;
  }
  function inserir(nome, o) { return inserirVarios(nome, [o])[0]; }
  /** Índices das colunas de texto (IDs, nomes, datas AAAA-MM-DD); números (valores, dias) e 1/0 ficam como número na planilha. */
  function colunasTexto(nome) { var e = ESQ[nome], l = []; e.tipos.forEach(function (t, i) { if (t === 's') l.push(i); }); return l; }
  /** Aplica "texto simples" só nas colunas de texto, em blocos contíguos (poucas chamadas à planilha). */
  function formatarTexto(sh, nome, linha, n) {
    var cols = colunasTexto(nome), i = 0;
    while (i < cols.length) { var j = i; while (j + 1 < cols.length && cols[j + 1] === cols[j] + 1) j++; sh.getRange(linha, cols[i] + 1, n, cols[j] - cols[i] + 1).setNumberFormat('@'); i = j + 1; }
  }
  function localizar(nome, sh, o) {
    var id = o[ESQ[nome].nomes[0]], r = o._r;
    if (r && String(sh.getRange(r, 1).getValue()) === String(id)) return r;
    var n = sh.getLastRow(); if (n < 2) return 0;
    var col = sh.getRange(2, 1, n - 1, 1).getValues();
    for (var i = 0; i < col.length; i++) if (String(col[i][0]) === String(id)) return i + 2;
    return 0;
  }
  function atualizar(nome, o) {
    var e = ESQ[nome], sh = aba(nome), r = localizar(nome, sh, o); garantirCabecalho(nome, sh);
    if (!r) throw erro_(404, 'Registro não encontrado (pode ter sido removido por outra pessoa).');
    o._r = r; sh.getRange(r, 1, 1, e.nomes.length).setValues([paraLinha(nome, o)]);
    var mem = memo[nome]; bump(nome);
    if (mem) { // mantém a cópia em memória coerente com o que foi gravado
      var idc = e.nomes[0]; memo[nome] = mem;
      for (var i = 0; i < mem.length; i++) if (mem[i][idc] === o[idc]) { if (mem[i] !== o) Object.keys(o).forEach(function (k) { mem[i][k] = o[k]; }); break; }
    }
    return o;
  }
  function excluir(nome, o) {
    var sh = aba(nome), r = localizar(nome, sh, o);
    if (!r) throw erro_(404, 'Registro não encontrado.');
    sh.deleteRow(r); bump(nome);
  }
  function proximoNumero(chave) {
    var p = props(), k = 'SEQ_' + chave, v = p.getProperty(k);
    if (v == null) v = String(maximo(chave));
    var n = Number(v) + 1;
    p.setProperty(k, String(n)); return n;
  }
  var TAB_PREFIXO = { CAR: 'cartoes', CMP: 'compras', GAS: 'gastos', ACE: 'acertos', REC: 'recorrentes', MET: 'metas', APO: 'aportes', GAN: 'rendas' };
  function maximo(prefixo) {
    var tab = TAB_PREFIXO[prefixo]; if (!tab) return 0; var mx = 0;
    todos(tab).forEach(function (o) { var n = parseInt(String(o.id).slice(prefixo.length + 1), 10); if (n > mx) mx = n; });
    return mx;
  }
  function pad(n, d) { var s = String(n); while (s.length < d) s = '0' + s; return s; }
  /** Próximo ID legível (ex.: proximoId('GAS', 6) → GAS-000123). Deve rodar sob lock. */
  function proximoId(prefixo, digitos) {
    var n = proximoNumero(prefixo), tab = TAB_PREFIXO[prefixo];
    // garante que o contador nunca fique atrás do maior ID existente (ex.: linhas inseridas à mão)
    if (tab) { var mx = maximo(prefixo); if (mx >= n) { n = mx + 1; props().setProperty('SEQ_' + prefixo, String(n)); } }
    return prefixo + '-' + pad(n, digitos);
  }
  function definirSequencia(chave, valor) { props().setProperty('SEQ_' + chave, String(valor)); }
  function agoraISO() { return new Date().toISOString(); }
  function hojeISO() { return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); } // America/Recife (UTC-3, sem horário de verão)
  function config(chave, padrao) { var r = todos('config').filter(function (c) { return c.chave === chave; })[0]; return r && r.valor != null ? r.valor : padrao; }
  function definirConfig(chave, valor) {
    var r = todos('config').filter(function (c) { return c.chave === chave; })[0];
    if (r) { r.valor = String(valor); atualizar('config', r); } else inserir('config', { chave: chave, valor: String(valor) });
  }
  function auditar(usuario, acao, entidade, entidadeId, detalhe) {
    var d = detalhe == null ? '' : (typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe));
    pend.push({ quando: agoraISO(), usuario: usuario || '', acao: acao, entidade: entidade || '', entidade_id: entidadeId || '', detalhe: d.slice(0, 4000) });
  }
  /** Grava os registros de auditoria pendentes (chamado ao final de cada requisição). */
  function descarregarAuditoria() {
    if (!pend.length) return;
    var itens = pend; pend = [];
    try {
      var sh = aba('auditoria'), ult = Math.max(sh.getLastRow(), 1), ini = ult + 1;
      garantirLinhas(sh, ini + itens.length - 1);
      var rng = sh.getRange(ini, 1, itens.length, ESQ.auditoria.nomes.length); rng.setNumberFormat('@');
      rng.setValues(itens.map(function (o, i) { o.id = ult - 1 + i + 1; return paraLinha('auditoria', o); }));
    } catch (e) { console.error('Falha ao gravar auditoria: ' + e.message); }
  }
  function ultimasAuditorias(limite) {
    var e = ESQ.auditoria, sh = aba('auditoria'), n = sh.getLastRow(); if (n < 2) return [];
    var ini = Math.max(2, n - limite * 3 + 1), vals = sh.getRange(ini, 1, n - ini + 1, e.nomes.length).getValues(), out = [];
    vals.forEach(function (row) { var o = {}; e.nomes.forEach(function (c, j) { o[c] = conv(row[j], e.tipos[j]); }); if (o.id != null) out.push(o); });
    return out;
  }
  function limparCache() { Object.keys(ESQ).forEach(function (n) { try { props().setProperty('V_' + n, Date.now() + '-' + Math.random().toString(36).slice(2, 8)); } catch (e) {} }); memo = {}; mapas = {}; versoes = {}; geracao++; }
  function reiniciarMemoria() { memo = {}; mapas = {}; versoes = {}; pend = []; geracao++; }
  return {
    ESQ: ESQ, planilha: planilha, aba: aba, todos: todos, mapa: mapa, porId: porId, inserir: inserir, inserirVarios: inserirVarios, atualizar: atualizar, excluir: excluir,
    proximoId: proximoId, proximoNumero: proximoNumero, definirSequencia: definirSequencia, maximo: maximo, agoraISO: agoraISO, hojeISO: hojeISO, config: config, definirConfig: definirConfig,
    auditar: auditar, descarregarAuditoria: descarregarAuditoria, ultimasAuditorias: ultimasAuditorias, limparCache: limparCache, reiniciarMemoria: reiniciarMemoria,
    geracao: function () { return geracao; }, props: props, conv: conv, paraLinha: paraLinha, garantirLinhas: garantirLinhas,
    /** Marca a tabela como alterada por fora (ex.: edição direta na planilha). */
    invalidar: function (nome) { if (ESQ[nome]) bump(nome); }, garantirCabecalho: garantirCabecalho, ativoDe: ativoDe, colunasTexto: colunasTexto, formatarTexto: formatarTexto
  };
})();
