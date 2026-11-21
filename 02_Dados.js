/**
 * Camada de dados: Google Planilhas como banco (uma aba por tabela, linha 1 = cabeçalho, dados a partir da linha 2).
 *  • Todas as colunas de texto usam formato "texto simples" (@): datas ISO (AAAA-MM-DD) e meses (AAAA-MM)
 *    nunca são convertidos pela planilha.
 *  • Gravações devem ocorrer sob LockService (feito pelo roteador em 01_Web.js).
 *
 * V1.4 — a mesma camada de dados do SIG - Infraestrutura (V6.3 a V6.16), adaptada às tabelas deste app:
 *  • propriedades do script lidas UMA vez por requisição (retrato) e gravadas de uma vez no fim (versões, contadores, manifestos);
 *  • cache compartilhado em BLOCOS DE LINHAS: ler várias tabelas custa uma ida ao cache; gravar regrava só o bloco alterado
 *    e a requisição seguinte não precisa reler a aba da planilha;
 *  • pré-carga automática por rota: o app aprende quais tabelas cada tela usa e as traz, junto com a sessão, numa só ida ao cache;
 *  • localizar/atualizar/excluir várias linhas com uma leitura da coluna A (sem reler a aba a cada registro);
 *  • FORMATO COMPACTADO das tabelas que crescem (COMPRAS_CARTAO, GASTOS_PIX_DEBITO, NOTIFICACOES): 2 colunas por linha
 *    (ID + registro em JSON) em vez de 11 a 17 — menos células = leitura mais rápida (conversão em 15_Compactar.js).
 */
var D = (function () {
  var ESQ = {
    // V1.4: USUARIOS, FATURAS, ACERTOS e CONFIG passam a usar o cache (USUARIOS com 2 min, como no SIG: alteração à mão aparece logo)
    usuarios:  { aba: 'USUARIOS',  cols: 'email:s nome:s ativo:n criado_em:s ultimo_acesso:s', cache: 1, ttl: 120 },
    // cartões de crédito: cada cartão tem um titular (quem paga a fatura). Fatura identificada pelo mês de VENCIMENTO.
    cartoes:   { aba: 'CARTOES',   cols: 'id:s titular:s nome:s final:s dia_fechamento:n dia_vencimento:n ativo:n criado_em:s', cache: 1 },
    // compras no cartão (à vista = 1 parcela). As parcelas são calculadas: parcela k cai na fatura primeira_fatura + (k − 1).
    // divisao: INDIVIDUAL (só de quem pagou) | DIVIDIDO (meio a meio) | OUTRO (todo do(a) parceiro(a))
    // terceiro: alguém de fora do casal (mãe, amigo…) que paga terceiro_valor (total) dessa compra; só o resto entra na divisão do casal
    compras:   { aba: 'COMPRAS_CARTAO', cols: 'id:s cartao_id:s descricao:s categoria:s data_compra:s valor_total:n parcelas:n primeira_fatura:s divisao:s obs:s criado_por:s criado_em:s atualizado_por:s atualizado_em:s terceiro:s terceiro_valor:n terceiro_recebido:n', cache: 1, novasNoFim: 1, compactavel: 1 },
    faturas:   { aba: 'FATURAS',   cols: 'id:s cartao_id:s mes:s paga:n paga_em:s paga_por:s', cache: 1 },
    // gastos em pix / débito / dinheiro: pago_por = quem lançou (quem pagou)
    gastos:    { aba: 'GASTOS_PIX_DEBITO', cols: 'id:s data:s descricao:s categoria:s forma:s valor:n pago_por:s divisao:s obs:s criado_por:s criado_em:s atualizado_por:s atualizado_em:s ref_externa:s', cache: 1, novasNoFim: 1, compactavel: 1 },
    // gastos fixos (recorrentes): entram todo mês de inicio até fim (vazio = sem fim). tipo CARTAO (na fatura do cartão) ou PIX (pix/débito/dinheiro)
    recorrentes: { aba: 'RECORRENTES', cols: 'id:s tipo:s cartao_id:s forma:s dono:s descricao:s categoria:s valor:n dia:n divisao:s inicio:s fim:s obs:s criado_por:s criado_em:s atualizado_por:s atualizado_em:s', cache: 1 },
    // ganhos de cada pessoa: FIXA (todo mês de inicio até fim, ex.: salário) ou AVULSA (só no mês de inicio, ex.: 13º, freela)
    rendas:    { aba: 'GANHOS',    cols: 'id:s pessoa:s descricao:s tipo:s valor:n dia:n inicio:s fim:s obs:s criado_por:s criado_em:s atualizado_por:s atualizado_em:s', cache: 1 },
    // metas de economia (viagem, carro…) e os depósitos feitos para cada uma (retirada = valor negativo)
    metas:     { aba: 'METAS',     cols: 'id:s nome:s categoria:s valor_alvo:n valor_inicial:n mes_alvo:s rendimento_mes:n pessoa1:s pct1:n ativa:n concluida_em:s obs:s criado_por:s criado_em:s atualizado_por:s atualizado_em:s', cache: 1 },
    aportes:   { aba: 'META_APORTES', cols: 'id:s meta_id:s data:s valor:n quem:s obs:s criado_por:s criado_em:s', cache: 1 },
    // acertos: pagamentos feitos entre o casal para zerar o saldo de um mês
    acertos:   { aba: 'ACERTOS',   cols: 'id:s mes:s de:s para:s valor:n data:s obs:s criado_por:s criado_em:s', cache: 1 },
    // limites (tetos) mensais por categoria, de cada pessoa — comparados com a "sua parte" dos gastos
    limites:   { aba: 'LIMITES',   cols: 'id:s dono:s categoria:s valor:n obs:s criado_em:s atualizado_em:s', cache: 1 },
    // V1.3: notificações para o(a) parceiro(a) (compras e pix/débito divididos lançados, alterados ou excluídos)
    notificacoes: { aba: 'NOTIFICACOES', cols: 'id:s para:s de:s tipo:s titulo:s texto:s rota:s query:s ref:s criado_em:s lida_em:s', cache: 1, compactavel: 1 },
    // V1.5: gastos fixos de pix/débito/boleto marcados como pagos (um registro por gasto fixo e mês; id = REC-xxxx|AAAA-MM)
    pagamentos: { aba: 'PAGAMENTOS_FIXOS', cols: 'id:s recorrente_id:s mes:s pago:n pago_em:s pago_por:s', cache: 1 },
    auditoria: { aba: 'AUDITORIA', cols: 'id:n quando:s usuario:s acao:s entidade:s entidade_id:s detalhe:s' },
    config:    { aba: 'CONFIG',    cols: 'chave:s valor:s', cache: 1 }
  };
  Object.keys(ESQ).forEach(function (k) {
    var e = ESQ[k]; e.nomes = []; e.tipos = [];
    e.cols.split(' ').forEach(function (c) { var p = c.split(':'); e.nomes.push(p[0]); e.tipos.push(p[1]); });
    e.cab = e.nomes;   // cabeçalho (linha 1) = o próprio nome da coluna
  });
  var CACHE_TTL = 600, BLOCO = 24000, BLOCO_MAX = 32000;   // blocos do cache: ~24 mil caracteres (limite do serviço: 100 KB por chave)
  var memo = {}, mapas = {}, versoes = {}, ss = null, pend = [], geracao = 0;
  // ---- otimizações (por requisição) ----
  // snap: TODAS as propriedades do script lidas numa única chamada (versões das tabelas, contadores, senhas…), em vez de uma chamada por chave.
  // adiado/pendProps: dentro da trava do api(), versões e contadores são gravados de uma vez só no fim (setProperties), ANTES de soltar a trava.
  // pos: posição (linha) de cada ID na aba, lida de uma vez (coluna A) para localizar linhas em gravações seguidas sem reler a planilha.
  // abasMemo: objetos Sheet já abertos (getSheetByName é uma ida ao servidor). maxMemo: maior ID por prefixo (varredura) por versão da tabela.
  var snap = null, adiado = false, pendProps = {}, pos = {}, abasMemo = {}, maxMemo = {}, cfgMemo = null, celula = {};
  // bruto: cada aba como está na planilha (matriz a partir da linha 2), lida uma vez por requisição — base dos objetos (memo)
  var bruto = {}, fmtMemo = {};
  // cache em blocos: man = manifesto por tabela; textos = blocos como estão no cache; origem = quando a tabela foi lida da planilha;
  // pre = chaves do cache já trazidas nesta requisição; vivas = tabelas gravadas cuja cópia em memória segue igual à planilha (vão para o cache ao fim da gravação)
  var man = {}, textos = {}, origem = {}, pre = {}, vivas = {};
  // pendAgr: propriedades que esperam o fim da requisição; rotaAtual/dica/usadas: pré-carga automática por rota
  var agrupar = false, pendAgr = {}, pendBlocos = {}, rotaAtual = '', dica = [], usadas = {};

  function props() { return PropertiesService.getScriptProperties(); }
  /** Valor de uma propriedade do script (lido do retrato da requisição: uma única chamada ao serviço). */
  function prop(k) {
    if (Object.prototype.hasOwnProperty.call(pendProps, k)) return pendProps[k];
    if (!snap) { try { snap = props().getProperties() || {}; } catch (e) { return props().getProperty(k); } }
    return Object.prototype.hasOwnProperty.call(snap, k) ? snap[k] : null;
  }
  /** Mantém o retrato coerente quando outro módulo grava/apaga uma propriedade (v null = apagada). */
  function propLocal(k, v) { if (snap) { if (v == null) delete snap[k]; else snap[k] = String(v); } }
  function gravarProp(k, v) {
    v = String(v);
    if (adiado) pendProps[k] = v; else props().setProperty(k, v);
    propLocal(k, v);
  }
  /** Propriedade que pode esperar o fim da requisição (manifesto do cache, lista de tabelas da rota): vai junto com as demais numa só gravação. */
  function propAgrupada(k, v) {
    v = String(v);
    if (adiado) pendProps[k] = v; else if (agrupar) pendAgr[k] = v; else props().setProperty(k, v);
    propLocal(k, v);
  }
  /**
   * Fecha uma gravação (deve rodar antes de soltar a trava), nesta ordem:
   *  1) confirma na planilha o que foi escrito (flush) — quem pegar a trava em seguida já enxerga as linhas novas;
   *  2) regrava no cache só os blocos alterados das tabelas gravadas (a próxima requisição não precisa reler a planilha);
   *  3) grava de uma vez versões, contadores e manifestos (uma chamada).
   */
  function descarregar() {
    var vs = Object.keys(vivas), falhou = false; vivas = {};
    if (adiado && ss) { try { SpreadsheetApp.flush(); } catch (e) { falhou = true; try { console.error('Falha ao confirmar a gravação na planilha: ' + e.message); } catch (_) {} } }
    var lote = pendBlocos, feitas = []; pendBlocos = {};
    vs.forEach(function (n) {
      if (falhou) { delete bruto[n]; delete memo[n]; delete mapas[n]; delete pos[n]; return; }
      if (adiado && bruto[n] && origem[n]) { try { if (publicar(n, bruto[n], origem[n], textos[n], lote)) feitas.push(n); } catch (e) { /* cache é só otimização */ } }
    });
    if (Object.keys(lote).length) {   // blocos alterados de todas as tabelas gravadas: uma só ida ao cache
      try { putLote(lote, CACHE_TTL); }
      catch (e) { Object.keys(pendProps).forEach(function (k) { if (k.indexOf('M_') === 0) { delete pendProps[k]; man[k.slice(2)] = null; } }); }   // sem os blocos, nenhum manifesto pode ser publicado
    }
    var ks = Object.keys(pendProps); if (!ks.length) return;
    var o = pendProps; pendProps = {};
    try { props().setProperties(o); }
    catch (e) { ks.forEach(function (k) { try { props().setProperty(k, o[k]); } catch (e2) { console.error('Falha ao gravar ' + k + ': ' + e2.message); } }); }
  }
  function adiar(sim) { if (!sim) descarregar(); adiado = !!sim; }
  function planilha() {
    if (ss) return ss;
    var id = prop('PLANILHA_ID');   // do retrato das propriedades (já lido para as versões das tabelas)
    if (!id) throw erro_(503, 'A planilha de dados ainda não foi criada. Execute a função instalar() no editor do Apps Script.');
    ss = SpreadsheetApp.openById(id); return ss;
  }
  function folha(nomeAba) {
    var sh = abasMemo[nomeAba]; if (sh) return sh;
    sh = planilha().getSheetByName(nomeAba); if (sh) abasMemo[nomeAba] = sh; return sh;
  }
  function aba(nome) {
    var e = ESQ[nome]; if (!e) throw new Error('Tabela desconhecida: ' + nome);
    var sh = folha(e.aba);
    if (!sh) { // tabela nova numa versão do app: cria a aba com o cabeçalho, em colunas (não mexe nas outras)
      sh = planilha().insertSheet(e.aba); if (sh.getMaxColumns() < e.nomes.length) sh.insertColumnsAfter(sh.getMaxColumns(), e.nomes.length - sh.getMaxColumns());
      sh.getRange(1, 1, 1, e.nomes.length).setNumberFormat('@').setValues([e.nomes]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#334155'); sh.setFrozenRows(1);
      formatarTexto(sh, nome, 2, sh.getMaxRows() - 1);
      abasMemo[e.aba] = sh; fmtAba[nome] = false;
    }
    return sh;
  }
  /** 'b' = ativo/inativo: aceita 1/0 e Sim/Não; vazio conta como ativo. */
  function ativoDe(v) {
    var t = String(v == null ? '' : v).trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (t === '' || t === '1' || t === 'SIM' || t === 'S' || t === 'TRUE' || t === 'VERDADEIRO' || t === 'ATIVO' || t === 'ATIVA') return 1;
    return 0;
  }
  /** Data da planilha → AAAA-MM-DD (fuso do app); memorizado por valor (datas se repetem muito). */
  function fmtData(v) { var t = v.getTime(), r = fmtMemo[t]; if (r === undefined) { r = Utilities.formatDate(v, APP.TZ, 'yyyy-MM-dd'); fmtMemo[t] = r; } return r; }
  function conv(v, t) {
    if (t === 'b') return ativoDe(v);
    if (v instanceof Date) v = fmtData(v);
    if (v === '' || v == null) return null;
    if (t === 'n') { var x = Number(v); return isNaN(x) ? null : x; }
    return String(v);
  }
  // ---------------------------------------------------------------------------------------------------------------------------
  //  FORMATO COMPACTADO (do SIG V6.16) — tabelas com compactavel: COMPRAS_CARTAO, GASTOS_PIX_DEBITO, NOTIFICACOES.
  //  A aba fica com 2 colunas: A = ID (texto; é por ela que as linhas são localizadas) e B = o resto do registro em JSON.
  //  O Google cobra por célula lida: 17 colunas viram 2 (no SIG, leitura ~4,5x mais rápida).
  //  O formato é reconhecido pelo CABEÇALHO da aba (B1 começa com "§1"), nunca por configuração: uma cópia de segurança antiga
  //  (formato de colunas) restaurada continua funcionando. Para o resto do app nada muda — as "linhas" em memória e no cache
  //  são as mesmas (uma posição por coluna do esquema). A conversão (com cópia de segurança e volta) fica em 15_Compactar.js.
  // ---------------------------------------------------------------------------------------------------------------------------
  var MARCA_CP = '§1', CAB_CP = ['id', '§1 registro compactado pelo app — não edite esta aba à mão'], LIM_CP = 49000, fmtAba = {};
  function ehCabCompacto(v) { return String(v == null ? '' : v).indexOf(MARCA_CP) === 0; }
  /** A aba da tabela está no formato compactado? Conferido no cabeçalho uma vez por execução (já sabido se a aba foi lida da planilha). */
  function compacta(nome, shOpc) {
    var e = ESQ[nome]; if (!e || !e.compactavel) return false;
    if (fmtAba[nome] !== undefined) return fmtAba[nome];
    var sh = shOpc || folha(e.aba); if (!sh) return false;
    var v = ''; try { v = sh.getRange(1, 2).getValue(); } catch (er) { v = ''; }
    return (fmtAba[nome] = ehCabCompacto(v));
  }
  /** Valor como fica guardado no formato compactado (exatamente o que volta na leitura). */
  function valCP(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return isNaN(v.getTime()) ? '' : fmtData(v);
    if (typeof v === 'number' && !isFinite(v)) return '';
    return v;
  }
  function linhaCP(row) { return row.map(valCP); }
  /** Linhas (uma posição por coluna) → linhas da aba compactada [ID, JSON do resto]. */
  function empacotar(nome, rows) {
    return rows.map(function (r) {
      var s = JSON.stringify(r.slice(1).map(valCP));
      if (s.length > LIM_CP) throw erro_(400, 'Um registro ficou grande demais para gravar (' + s.length + ' caracteres; o limite é ' + LIM_CP + '). Encurte a descrição ou a observação.');
      return [valCP(r[0]) === '' ? '' : String(r[0]), s];
    });
  }
  /** Linhas da aba compactada (sem o cabeçalho) → linhas do app (uma posição por coluna; colunas novas no fim ficam vazias). */
  function desempacotar(nome, vals) {
    var e = ESQ[nome], nn = e.nomes.length, out = new Array(vals.length);
    for (var i = 0; i < vals.length; i++) {
      var a = vals[i][0], b = vals[i][1], row;
      a = a === '' || a == null ? '' : String(a);
      if (b === '' || b == null) row = [a];
      else {
        var p; try { p = JSON.parse(b); } catch (er) { p = null; }
        if (!Array.isArray(p)) throw erro_(500, 'A linha ' + (i + 2) + ' da aba ' + e.aba + ' foi alterada à mão e não pôde ser lida (formato compactado). Desfaça a alteração na planilha (Arquivo ▸ Histórico de versões) ou restaure a cópia de segurança.');
        row = [a].concat(p);
      }
      if (row.length > nn) row.length = nn;
      while (row.length < nn) row.push('');
      out[i] = row;
    }
    return out;
  }
  function versao(nome) { if (versoes[nome] === undefined) versoes[nome] = prop('V_' + nome) || '0'; return versoes[nome]; }
  /** Nova versão da tabela (invalida o cache compartilhado). manter = a própria camada já deixou memória/mapa/posições coerentes. */
  function bump(nome, manter) {
    var v = Date.now() + '-' + Math.random().toString(36).slice(2, 8); versoes[nome] = v; gravarProp('V_' + nome, v);
    if (!manter) { delete memo[nome]; delete mapas[nome]; delete pos[nome]; delete bruto[nome]; delete textos[nome]; delete origem[nome]; delete vivas[nome]; }
    man[nome] = null;   // o manifesto do cache era da versão anterior
    if (nome === 'config') cfgMemo = null;
    geracao++;
  }
  function ttlDe(nome) { return ESQ[nome].ttl || CACHE_TTL; }
  // ---------------------------------------------------------------------------------------------------------------------------
  //  Cache compartilhado (CacheService) — cada tabela é guardada em BLOCOS DE LINHAS, com chaves próprias ('dr_<tabela>_<aleatório>').
  //  O "manifesto" da tabela (versão, hora em que foi lida da planilha, linhas por bloco e as chaves dos blocos) fica na propriedade
  //  M_<tabela>, que já vem no retrato das propriedades da requisição. Com isso:
  //   • ler uma tabela (ou várias — precarregar) custa UMA ida ao cache, qualquer que seja o tamanho;
  //   • ao gravar, só os blocos alterados são regravados e a tabela não precisa ser relida da planilha pela requisição seguinte;
  //   • os blocos valem até 10 min depois da última leitura DA PLANILHA (alterações feitas à mão aparecem nesse prazo, como antes).
  //  O manifesto só vale se for da versão atual da tabela (V_<tabela>); qualquer gravação fora deste caminho gera versão nova e ele é ignorado.
  // ---------------------------------------------------------------------------------------------------------------------------
  var MARCA_DATA = '\u0000D';
  function cacheSvc() { return CacheService.getScriptCache(); }
  function manifesto(nome) {
    if (man[nome] !== undefined) return man[nome];
    var s = prop('M_' + nome), r = null;
    if (s) {
      var p = String(s).split('|'), o = Number(p[1]);
      if (p.length === 5 && p[0] === versao(nome) && o > 0 && Date.now() - o < ttlDe(nome) * 1000 - 5000) r = { o: o, R: Number(p[2]) || 1, d: p[3] === '1', k: p[4] ? p[4].split(',') : [] };
    }
    return (man[nome] = r);
  }
  /** Busca no cache, de uma vez, as chaves que ainda não foram pedidas nesta requisição (as ausentes ficam marcadas como null). */
  function buscar(ks) {
    ks = ks.filter(function (k) { return !Object.prototype.hasOwnProperty.call(pre, k); }); if (!ks.length) return;
    for (var i = 0; i < ks.length; i += 40) {   // até ~1 MB por ida (40 blocos)
      var parte = ks.slice(i, i + 40), got = cacheSvc().getAll(parte) || {};
      parte.forEach(function (k) { pre[k] = got[k] != null ? got[k] : null; });
    }
  }
  /** Grava vários blocos no cache, em idas de até ~900 mil caracteres. */
  function putLote(o, ttl) {
    var parte = {}, tam = 0, c = cacheSvc();
    Object.keys(o).forEach(function (k) { if (tam && tam + o[k].length > 900000) { c.putAll(parte, ttl); parte = {}; tam = 0; } parte[k] = o[k]; tam += o[k].length; });
    if (tam) c.putAll(parte, ttl);
  }
  /** Valor de uma chave do cache já trazida nesta requisição (undefined = ainda não foi pedida; null = não existe). */
  function cacheLido(k) { return Object.prototype.hasOwnProperty.call(pre, k) ? pre[k] : undefined; }
  /** Pré-carrega do cache várias tabelas (e chaves avulsas, como a da sessão) numa única chamada. As que faltarem são lidas da planilha depois, normalmente. */
  function precarregar(nomes, extras) {
    try {
      var ks = (extras || []).slice();
      (nomes || []).forEach(function (n) { if (!ESQ[n] || !ESQ[n].cache || bruto[n]) return; var mf = manifesto(n); if (mf) ks = ks.concat(mf.k); });
      buscar(ks);
    } catch (e) { /* cache é só otimização */ }
  }
  /** Pedido explícito de uma tela: traz as tabelas agora e as inclui na lista da rota (da próxima vez já vêm na ida única do início). */
  function preparar(nomes) { (nomes || []).forEach(function (n) { usadas[n] = 1; }); precarregar(nomes); }
  /** Blocos (texto) → matriz. Datas voltam a ser datas. */
  function montar(partes, comData) {
    try {
      var m = partes.length ? JSON.parse('[' + partes.map(function (p) { return p.slice(1, -1); }).filter(function (p) { return p !== ''; }).join(',') + ']') : [];
      if (comData) for (var i = 0; i < m.length; i++) for (var j = 0; j < m[i].length; j++) { var v = m[i][j]; if (typeof v === 'string' && v.charCodeAt(0) === 0 && v.charAt(1) === 'D') m[i][j] = new Date(Number(v.slice(2))); }
      return m;
    } catch (e) { return null; }
  }
  function doCache(nome) {
    try {
      var mf = manifesto(nome); if (!mf) return null;
      buscar(mf.k);
      var partes = []; for (var i = 0; i < mf.k.length; i++) { var b = pre[mf.k[i]]; if (b == null) return null; partes.push(b); }
      var m = montar(partes, mf.d); if (!m) return null;
      origem[nome] = mf.o; textos[nome] = { k: mf.k, s: partes, R: mf.R };
      return m;
    } catch (e) { return null; }
  }
  /** Matriz → blocos de R linhas (texto JSON). Datas viram '\u0000D<ms>' (o JSON comum as transformaria em texto). */
  function emBlocos(m, R0) {
    var n = m.length, txt = new Array(n), tot = 0, d = false;
    for (var i = 0; i < n; i++) {
      var row = m[i], temD = false;
      for (var j = 0; j < row.length; j++) if (row[j] instanceof Date) { temD = true; break; }
      if (temD) { d = true; row = row.map(function (v) { return v instanceof Date ? MARCA_DATA + v.getTime() : v; }); }
      var s = JSON.stringify(row); txt[i] = s; tot += s.length + 1;
    }
    var ideal = Math.max(1, Math.ceil(n / Math.max(1, Math.ceil(tot / BLOCO))));
    var R = R0 && R0 * 2 >= ideal && R0 <= ideal * 2 ? R0 : ideal;   // mantém a divisão anterior (só os blocos alterados são regravados) enquanto ela for razoável
    for (;;) {
      var out = [], cabe = true;
      for (var a = 0; a < n; a += R) { var bl = '[' + txt.slice(a, a + R).join(',') + ']'; if (bl.length > BLOCO_MAX) { cabe = false; break; } out.push(bl); }
      if (cabe) return { R: R, s: out, d: d };
      if (R === 1) return null;   // uma linha sozinha não cabe num bloco: tabela fica sem cache
      R = Math.max(1, Math.floor(R / 2));
    }
  }
  /** Publica a tabela no cache: grava só os blocos que mudaram (em relação a "antigo") e deixa o manifesto para ser gravado nas propriedades. */
  function publicar(nome, m, o, antigo, lote) {
    // (o prazo de validade é conferido pelo manifesto — hora da leitura da planilha —, não pela duração de cada bloco no cache)
    if (ttlDe(nome) - (Date.now() - o) / 1000 < 20) return false;
    var bl = emBlocos(m, antigo ? antigo.R : 0); if (!bl) return false;
    var put = {}, ks = [], n = 0, igual = antigo && antigo.R === bl.R;
    for (var i = 0; i < bl.s.length; i++) {
      if (igual && antigo.s[i] === bl.s[i]) { ks.push(antigo.k[i]); continue; }
      var k = 'dr_' + nome + '_' + Math.random().toString(36).slice(2, 10) + i.toString(36); ks.push(k); put[k] = bl.s[i]; n++;
    }
    if (ks.length > 350) return false;   // manifesto não caberia numa propriedade (tabela de vários MB): fica sem cache
    if (!lote && (adiado || agrupar)) lote = pendBlocos;   // dentro de uma requisição: os blocos de todas as tabelas vão ao cache juntos, no fim
    if (n) { if (lote) Object.keys(put).forEach(function (k2) { lote[k2] = put[k2]; }); else putLote(put, ttlDe(nome)); }
    propAgrupada('M_' + nome, [versao(nome), o, bl.R, bl.d ? 1 : 0, ks.join(',')].join('|'));
    man[nome] = { o: o, R: bl.R, d: bl.d, k: ks }; textos[nome] = { k: ks, s: bl.s, R: bl.R };
    return true;
  }
  /** A cópia em memória da tabela, quando pode acompanhar as gravações desta requisição (dentro da trava, tabela com cache e lida do cache/planilha). */
  function brutoVivo(nome) { return adiado && ESQ[nome].cache && bruto[nome] && origem[nome] ? bruto[nome] : null; }
  /** Depois de uma gravação: a cópia em memória (já igual à planilha) continua valendo e vai para o cache quando a gravação terminar. */
  function manterBruto(nome, b, t, og) { bruto[nome] = b; if (t) textos[nome] = t; origem[nome] = og; vivas[nome] = 1; }
  /** A linha gravada volta da planilha exatamente como foi escrita? (texto em coluna de texto, número em coluna numérica) — senão, a tabela é relida. */
  function linhaSegura(e, row) {
    for (var j = 0; j < row.length; j++) {
      var v = row[j], t = e.tipos[j]; if (v === '') continue;
      if (t === 's') { if (typeof v !== 'string' || v.charAt(0) === "'") return false; }
      else if (t === 'n' || t === 'b') { if (typeof v !== 'number' || !isFinite(v)) return false; }
      else return false;
    }
    return true;
  }
  /** Valores da aba como estão na planilha (linha 2 em diante, largura da tabela; inclui linhas em branco). Uma única leitura. */
  function lerMatrizPlanilha(nome) {
    var e = ESQ[nome];
    if (!folha(e.aba)) return [];   // ainda não existe: vazia (é criada na primeira gravação)
    var vals = folha(e.aba).getDataRange().getValues(), nn = e.nomes.length;
    if (e.compactavel) {   // o cabeçalho diz o formato (lido junto, sem custo extra)
      var cp = !!vals.length && vals[0].length >= 2 && ehCabCompacto(vals[0][1]); fmtAba[nome] = cp;
      if (cp) return vals.length < 2 ? [] : desempacotar(nome, vals.slice(1));
    }
    if (vals.length < 2) return [];
    vals.shift();   // cabeçalho
    var w = vals[0].length;
    if (w > nn) vals = vals.map(function (r) { return r.slice(0, nn); });   // colunas além das do app não são lidas
    else if (w < nn) vals.forEach(function (r) { while (r.length < nn) r.push(''); });   // aba antiga com menos colunas: as que faltam ficam vazias
    return vals;
  }
  /** Linhas da aba como estão na planilha (o índice i é a linha i + 2). Lidas uma vez por requisição; cache compartilhado. Não altere. */
  function linhas(nome) {
    var b = bruto[nome]; if (b) return b;
    var e = ESQ[nome]; if (!e) throw new Error('Tabela desconhecida: ' + nome);
    usadas[nome] = 1;
    var m = e.cache ? doCache(nome) : null;
    if (!m) {
      var t0 = Date.now(); m = lerMatrizPlanilha(nome);
      if (e.cache) { origem[nome] = t0; try { publicar(nome, m, t0, null); } catch (er) { /* cache é só otimização */ } }
    }
    return (bruto[nome] = m);
  }
  // ---- pré-carga automática por rota: o app aprende quais tabelas cada rota usa (propriedade PRE_<rota>) e, da vez seguinte,
  //      traz todas — mais a sessão de quem chama — numa única ida ao cache ----
  /** Início da requisição. soBase = rota que grava: antes da trava só interessa quem está chamando (o resto é lido dentro da trava). */
  function rota(chave, extras, soBase) {
    rotaAtual = String(chave || ''); usadas = {}; dica = []; agrupar = true;
    var h = rotaAtual ? prop('PRE_' + rotaAtual) : null;
    if (h) { var p = String(h).split('|'); if (p[0] === APP.VERSAO && p[1]) dica = p[1].split(',').filter(function (n) { return ESQ[n] && ESQ[n].cache; }); }
    precarregar(soBase ? ['usuarios'] : ['usuarios'].concat(dica), extras);
  }
  /** Dentro da trava (a memória foi esvaziada): traz de novo, numa ida, as tabelas da rota. */
  function retomarRota(extras) { precarregar(['usuarios'].concat(dica), extras); }
  /** Fim da rota (sem erro): guarda as tabelas usadas que ainda não estavam na lista da rota. */
  function aprender() {
    if (!rotaAtual) return;
    var novas = Object.keys(usadas).filter(function (n) { return dica.indexOf(n) < 0 && ESQ[n] && ESQ[n].cache && n !== 'usuarios'; });
    if (novas.length) { dica = dica.concat(novas); propAgrupada('PRE_' + rotaAtual, APP.VERSAO + '|' + dica.join(',')); }
  }
  /** Fim da requisição: grava de uma vez as propriedades deixadas para o fim (manifestos de tabelas lidas da planilha, lista da rota). */
  function fim() {
    var ks = Object.keys(pendAgr), o = pendAgr, bl = pendBlocos; pendAgr = {}; pendBlocos = {}; agrupar = false; rotaAtual = '';
    if (Object.keys(bl).length) {   // blocos das tabelas lidas da planilha nesta requisição: uma só ida ao cache
      try { putLote(bl, CACHE_TTL); }
      catch (e) { ks.forEach(function (k) { if (k.indexOf('M_') === 0) delete o[k]; }); ks = Object.keys(o); }
    }
    if (ks.length) { try { props().setProperties(o); } catch (e2) { /* só otimização */ } }
  }
  /**
   * Mantém o cache "quente": relê da planilha as tabelas cujo cache não existe ou tem mais de idadeMax segundos (acionador de tempo — aquecerCache).
   * Assim ninguém espera a leitura da planilha ao abrir uma tela, e o que for alterado à mão continua aparecendo em poucos minutos.
   */
  function aquecer(idadeMax) {
    var n = 0;
    Object.keys(ESQ).forEach(function (t) {
      var e = ESQ[t]; if (!e.cache) return;
      var mf = manifesto(t); if (mf && Date.now() - mf.o < Math.min(idadeMax, ttlDe(t) / 2) * 1000) return;
      try { var t0 = Date.now(), m = lerMatrizPlanilha(t); bruto[t] = m; origem[t] = t0; if (publicar(t, m, t0, null)) n++; } catch (er) { /* aba ausente: segue */ }
    });
    return n;
  }
  /** Linhas → objetos do app (ignora linhas sem ID na 1ª coluna; _r = nº da linha na planilha). */
  function objetos(nome, vals) {
    var e = ESQ[nome], out = [], nomes = e.nomes, tipos = e.tipos, nn = nomes.length;
    for (var i = 0; i < vals.length; i++) {
      var row = vals[i]; if (row[0] === '' || row[0] == null) continue;
      var o = { _r: i + 2 };
      for (var j = 0; j < nn; j++) { var v = row[j]; o[nomes[j]] = typeof v === 'string' && tipos[j] === 's' ? (v === '' ? null : v) : conv(v, tipos[j]); }   // caso mais comum (texto) sem chamada de função
      out.push(o);
    }
    return out;
  }
  /** Todas as linhas da tabela (objetos). Não altere os objetos diretamente: use atualizar(). */
  function todos(nome) {
    if (memo[nome]) return memo[nome];
    return (memo[nome] = objetos(nome, linhas(nome)));
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
  /** Bancos criados antes de uma coluna nova no fim ganham o cabeçalho que falta (tabelas com novasNoFim). Nunca mexe em dados.
   *  Aba compactada: nada a fazer (as colunas novas ficam dentro do registro). */
  function garantirCabecalho(nome, shOpc) {
    var e = ESQ[nome]; if (!e || !e.novasNoFim || cabOk[nome]) return; cabOk[nome] = true;
    if (prop('CAB_' + nome) === String(e.nomes.length)) return;   // já conferido (com este nº de colunas) numa gravação anterior
    var sh = shOpc || folha(e.aba); if (!sh) return;
    if (compacta(nome, sh)) return;
    var n = e.nomes.length;
    if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
    var atual = sh.getRange(1, 1, 1, n).getValues()[0];
    for (var i = 0; i < n; i++) if (String(atual[i] == null ? '' : atual[i]).trim() === '') sh.getRange(1, i + 1).setValue(e.nomes[i]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#334155');
    propAgrupada('CAB_' + nome, e.nomes.length);
  }
  function garantirLinhas(sh, ate) { var max = sh.getMaxRows(); if (ate > max) sh.insertRowsAfter(max, Math.max(ate - max, 300)); }
  /** Mantém memória, mapa e posições coerentes depois de acrescentar linhas (sem reler a planilha). */
  function aposInserir(nome, objs, rows, ini) {
    var tinha = memo[nome], mp = mapas[nome], ps = pos[nome], idc = ESQ[nome].nomes[0], e = ESQ[nome];
    var b = brutoVivo(nome), t = textos[nome], og = origem[nome];
    var cp = fmtAba[nome] === true;   // formato compactado: o que foi gravado volta exatamente igual
    var ok = !!b && b.length === ini - 2 && rows.every(function (r) { return cp || linhaSegura(e, r); });   // a cópia em memória termina exatamente onde a aba terminava
    bump(nome);
    if (tinha) {
      memo[nome] = tinha.concat(objs);
      if (mp) { objs.forEach(function (o) { mp[o[idc]] = o; }); mapas[nome] = mp; }
    }
    if (ps) { objs.forEach(function (o) { var k = String(o[idc]); (ps[k] = ps[k] || []).push(o._r); }); pos[nome] = ps; }
    if (ok) manterBruto(nome, b.concat(rows), t, og);
  }
  function inserirVarios(nome, objs) {
    if (!objs.length) return [];
    var e = ESQ[nome], sh = aba(nome), cp = compacta(nome, sh), ini = Math.max(sh.getLastRow(), 1) + 1; if (!cp) garantirCabecalho(nome, sh);
    var rows = objs.map(function (o) { return cp ? linhaCP(paraLinha(nome, o)) : paraLinha(nome, o); }), fis = cp ? empacotar(nome, rows) : rows;   // (empacotar confere o tamanho antes de gravar)
    garantirLinhas(sh, ini + objs.length - 1);
    var rng = sh.getRange(ini, 1, objs.length, cp ? 2 : e.nomes.length);
    if (cp) rng.setNumberFormat('@'); else formatarTexto(sh, nome, ini, objs.length);
    rng.setValues(fis);
    objs.forEach(function (o, i) { o._r = ini + i; });
    aposInserir(nome, objs, rows, ini);   // nova versão; a memória local continua válida e vai para o cache no fim da gravação
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
  /** Posições de todos os IDs da aba (uma leitura da coluna A), válidas até a próxima mudança de estrutura. */
  function posicoes(nome, sh) {
    if (pos[nome]) return pos[nome];
    var n = sh.getLastRow(), m = {};
    if (n >= 2) { var col = sh.getRange(2, 1, n - 1, 1).getValues(); for (var i = 0; i < col.length; i++) { var k = String(col[i][0]); (m[k] = m[k] || []).push(i + 2); } }
    return (pos[nome] = m);
  }
  /** Linha do registro: a que ele tinha ao ser lido (_r), se ainda for dele; senão a primeira com o mesmo ID (mesmo critério de antes). */
  function localizar(nome, sh, o) {
    var id = String(o[ESQ[nome].nomes[0]]);
    // 1ª gravação da tabela na requisição: confere só a célula da linha conhecida (1 chamada, como antes); a partir da 2ª, usa o mapa
    if (!pos[nome] && o._r && !celula[nome]) { celula[nome] = true; if (String(sh.getRange(o._r, 1).getValue()) === id) return o._r; }
    var l = posicoes(nome, sh)[id]; if (!l || !l.length) return 0;
    return o._r && l.indexOf(o._r) >= 0 ? o._r : l[0];
  }
  /** Depois de apagar a linha r: as de baixo sobem uma posição. */
  function aposApagar(nome, r) {
    var ps = pos[nome]; if (!ps) return;
    Object.keys(ps).forEach(function (k) { var l = ps[k], out = []; for (var i = 0; i < l.length; i++) { if (l[i] === r) continue; out.push(l[i] > r ? l[i] - 1 : l[i]); } if (out.length) ps[k] = out; else delete ps[k]; });
  }
  /** Copia o que foi gravado para a cópia em memória (se o objeto gravado não for o próprio da memória). */
  function refletir(nome, mem, o) {
    var idc = ESQ[nome].nomes[0];
    for (var i = 0; i < mem.length; i++) if (mem[i][idc] === o[idc]) { if (mem[i] !== o) Object.keys(o).forEach(function (k) { mem[i][k] = o[k]; }); break; }
  }
  function atualizar(nome, o) { atualizarVarios(nome, [o]); return o; }
  /** Grava vários registros já existentes: localiza todos com uma leitura e grava linhas vizinhas num só bloco; uma única nova versão no fim. */
  function atualizarVarios(nome, objs) {
    if (!objs.length) return objs;
    var e = ESQ[nome], sh = aba(nome), cp = compacta(nome, sh); if (!cp) garantirCabecalho(nome, sh);
    var itens = objs.map(function (o) { var r = localizar(nome, sh, o); if (!r) throw erro_(404, 'Registro não encontrado (pode ter sido removido por outra pessoa).'); o._r = r; return { r: r, o: o }; });
    var ultimo = {}; itens.forEach(function (x, i) { ultimo[x.r] = i; });   // mesma linha gravada duas vezes: vale a última (como antes)
    itens = itens.filter(function (x, i) { return ultimo[x.r] === i; }).sort(function (a, b) { return a.r - b.r; });
    var b = brutoVivo(nome), t = textos[nome], og = origem[nome], ok = !!b; if (ok) b = b.slice();
    var todas = itens.map(function (x) { return cp ? linhaCP(paraLinha(nome, x.o)) : paraLinha(nome, x.o); }), fisT = cp ? empacotar(nome, todas) : todas;   // tudo conferido antes da 1ª escrita
    for (var i = 0; i < itens.length;) {
      var j = i; while (j + 1 < itens.length && itens[j + 1].r === itens[j].r + 1) j++;
      var rows = todas.slice(i, j + 1);
      sh.getRange(itens[i].r, 1, j - i + 1, cp ? 2 : e.nomes.length).setValues(fisT.slice(i, j + 1));
      for (var k = 0; ok && k < rows.length; k++) {   // mesma linha na cópia em memória (só se for mesmo a linha desse registro)
        var r = itens[i + k].r, at = b[r - 2];
        if (at && String(at[0]) === String(rows[k][0]) && (cp || linhaSegura(e, rows[k]))) b[r - 2] = rows[k]; else ok = false;
      }
      i = j + 1;
    }
    var mem = memo[nome], mp = mapas[nome], ps = pos[nome]; bump(nome);
    if (mem) { memo[nome] = mem; objs.forEach(function (o) { refletir(nome, mem, o); }); if (mp) mapas[nome] = mp; }   // mantém a cópia em memória coerente com o que foi gravado
    if (ps) pos[nome] = ps;
    if (ok) manterBruto(nome, b, t, og);
    return objs;
  }
  function excluir(nome, o) { excluirVarios(nome, [o]); }
  /** Apaga vários registros: linhas vizinhas saem num só deleteRows (de baixo para cima); uma única nova versão no fim. */
  function excluirVarios(nome, objs) {
    if (!objs.length) return;
    var sh = aba(nome), rs = [], idc = ESQ[nome].nomes[0], b = brutoVivo(nome), t = textos[nome], og = origem[nome], ok = !!b;
    objs.forEach(function (o) {
      var r = localizar(nome, sh, o); if (!r) throw erro_(404, 'Registro não encontrado.');
      if (rs.indexOf(r) < 0) { rs.push(r); if (ok && !(b[r - 2] && String(b[r - 2][0]) === String(o[idc]))) ok = false; }
    });
    rs.sort(function (a, b2) { return b2 - a; });
    for (var i = 0; i < rs.length;) {
      var j = i; while (j + 1 < rs.length && rs[j + 1] === rs[j] - 1) j++;
      var topo = rs[j], qtd = j - i + 1;
      if (qtd === 1) sh.deleteRow(topo); else sh.deleteRows(topo, qtd);
      for (var k = i; k <= j; k++) aposApagar(nome, rs[k]);
      i = j + 1;
    }
    var ps = pos[nome]; bump(nome); if (ps) pos[nome] = ps;   // a memória (objetos, com _r) é remontada das linhas na próxima consulta
    if (ok) { var fora = {}; rs.forEach(function (r) { fora[r - 2] = 1; }); manterBruto(nome, b.filter(function (_, x) { return !fora[x]; }), t, og); }
  }
  /** Contador (próximo número) da sequência: lido do retrato/pendências; gravado (ou deixado pendente) na hora. */
  function seqLer(k) { return prop('SEQ_' + k); }
  function seqGravar(k, n) { gravarProp('SEQ_' + k, String(n)); }
  function proximoNumero(chave) {
    var v = seqLer(chave);
    if (v == null) v = String(maximo(chave));
    var n = Number(v) + 1;
    seqGravar(chave, n); return n;
  }
  var TAB_PREFIXO = { CAR: 'cartoes', CMP: 'compras', GAS: 'gastos', ACE: 'acertos', REC: 'recorrentes', MET: 'metas', APO: 'aportes', GAN: 'rendas', LIM: 'limites', NOT: 'notificacoes' }; // V1.2: LIM (limites) entrou — antes um contador zerado podia repetir ID
  /** Reserva vários IDs seguidos de uma vez (gravação em lote: um acesso às propriedades em vez de um por linha). */
  function reservarIds(prefixo, qtd, digitos) {
    if (!(qtd > 0)) return [];
    var atual = Number(seqLer(prefixo) || 0), mx = maximo(prefixo), n0 = Math.max(atual, mx) + 1;
    seqGravar(prefixo, n0 + qtd - 1);
    var out = []; for (var i = 0; i < qtd; i++) out.push(prefixo + '-' + pad(n0 + i, digitos)); return out;
  }
  /** Maior número já usado na tabela. Guardado por versão da tabela: chamadas seguidas (gravação em lote) não varrem a tabela de novo. */
  function maximo(prefixo) {
    var tab = TAB_PREFIXO[prefixo]; if (!tab) return 0;
    var v = versao(tab), mm = maxMemo[prefixo]; if (mm && mm.v === v && memo[tab] === mm.lista) return mm.mx;
    var lista = todos(tab), mx = 0;
    lista.forEach(function (o) { var n = parseInt(String(o.id).slice(prefixo.length + 1), 10); if (n > mx) mx = n; });
    maxMemo[prefixo] = { v: v, lista: lista, mx: mx };
    return mx;
  }
  function pad(n, d) { var s = String(n); while (s.length < d) s = '0' + s; return s; }
  /** Próximo ID legível (ex.: proximoId('GAS', 6) → GAS-000123). Deve rodar sob lock. */
  function proximoId(prefixo, digitos) {
    var n = proximoNumero(prefixo), tab = TAB_PREFIXO[prefixo];
    // garante que o contador nunca fique atrás do maior ID existente (ex.: linhas inseridas à mão)
    if (tab) { var mx = maximo(prefixo); if (mx >= n) { n = mx + 1; seqGravar(prefixo, n); } }
    return prefixo + '-' + pad(n, digitos);
  }
  function definirSequencia(chave, valor) { gravarProp('SEQ_' + chave, String(valor)); }
  function agoraISO() { return new Date().toISOString(); }
  function hojeISO() { return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); } // America/Recife (UTC-3, sem horário de verão)
  /** Configurações por chave (vale a primeira linha de cada chave, como antes), montadas uma vez por versão. */
  function cfgMapa() {
    if (cfgMemo && cfgMemo.lista === todos('config')) return cfgMemo.m;
    var lista = todos('config'), m = {}; lista.forEach(function (c) { if (!Object.prototype.hasOwnProperty.call(m, c.chave)) m[c.chave] = c; });
    cfgMemo = { lista: lista, m: m }; return m;
  }
  function config(chave, padrao) { var r = cfgMapa()[chave]; return r && r.valor != null ? r.valor : padrao; }
  function definirConfig(chave, valor) {
    var r = cfgMapa()[chave];
    if (r) { r.valor = String(valor); atualizar('config', r); } else inserir('config', { chave: chave, valor: String(valor) });
    cfgMemo = null;
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
  function limparCache() {
    descarregar();   // contadores/versões pendentes desta requisição não se perdem
    var o = {}; Object.keys(ESQ).forEach(function (n) { o['V_' + n] = Date.now() + '-' + Math.random().toString(36).slice(2, 8); });
    try { props().setProperties(o); } catch (e) { /* ignora */ }   // uma gravação em vez de uma por tabela
    pendProps = {}; memo = {}; mapas = {}; versoes = {}; snap = null; pos = {}; maxMemo = {}; cfgMemo = null; bruto = {}; abasMemo = {};
    man = {}; textos = {}; origem = {}; pre = {}; vivas = {}; fmtAba = {}; celula = {}; cabOk = {}; geracao++;
  }
  /** Esquece tudo o que foi lido nesta execução (para reler depois de pegar a trava). Pendências de versão/contador são gravadas antes. */
  function esquecerLeituras() {
    descarregar();
    memo = {}; mapas = {}; versoes = {}; snap = null; pos = {}; maxMemo = {}; cfgMemo = null; celula = {}; bruto = {};
    man = {}; textos = {}; origem = {}; pre = {}; vivas = {}; fmtAba = {}; geracao++;
  }
  function reiniciarMemoria() { esquecerLeituras(); pend = []; }
  return {
    ESQ: ESQ, planilha: planilha, aba: aba, folha: folha, todos: todos, linhas: linhas, mapa: mapa, porId: porId, inserir: inserir, inserirVarios: inserirVarios, atualizar: atualizar, atualizarVarios: atualizarVarios, excluir: excluir, excluirVarios: excluirVarios,
    proximoId: proximoId, reservarIds: reservarIds, proximoNumero: proximoNumero, definirSequencia: definirSequencia, maximo: maximo, agoraISO: agoraISO, hojeISO: hojeISO, config: config, definirConfig: definirConfig,
    auditar: auditar, descarregarAuditoria: descarregarAuditoria, ultimasAuditorias: ultimasAuditorias, limparCache: limparCache, reiniciarMemoria: reiniciarMemoria, esquecerLeituras: esquecerLeituras,
    geracao: function () { return geracao; }, props: props, prop: prop, propLocal: propLocal, adiar: adiar, descarregar: descarregar, preparar: preparar, rota: rota, retomarRota: retomarRota, aprender: aprender, fim: fim, cacheLido: cacheLido, aquecer: aquecer, conv: conv, paraLinha: paraLinha, garantirLinhas: garantirLinhas,
    /** Marca a tabela como alterada por fora (ex.: edição direta na planilha). */
    invalidar: function (nome) { if (ESQ[nome]) bump(nome); }, garantirCabecalho: garantirCabecalho, ativoDe: ativoDe, colunasTexto: colunasTexto, formatarTexto: formatarTexto,
    // formato compactado (15_Compactar.js, instalar)
    CAB_CP: CAB_CP, ehCabCompacto: ehCabCompacto, compacta: compacta, empacotar: empacotar, desempacotar: desempacotar, linhaCP: linhaCP, objetosDe: objetos,
    esquecerFormato: function (nome) { if (nome) delete fmtAba[nome]; else fmtAba = {}; }
  };
})();
