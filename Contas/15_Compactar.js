/**
 * V1.4 (do SIG V6.16) — FORMATO COMPACTADO das tabelas que crescem (COMPRAS_CARTAO, GASTOS_PIX_DEBITO e NOTIFICACOES).
 *
 * A planilha passa a ser só banco de dados: cada registro dessas abas ocupa 2 células (ID + registro em JSON) em vez de 11 a 17.
 * No SIG, medido no Google de verdade: leitura de ~3,5 s para ~0,8 s (o tempo depende do número de células).
 * A camada de dados (02_Dados.js) reconhece o formato pelo cabeçalho de cada aba e lê/grava os dois formatos.
 *
 * Conversão (tela Minha conta ▸ Planilha de dados, ou pelo editor: compactarPlanilha / descompactarPlanilha):
 *  1) cópia de segurança da planilha inteira no Drive (pasta "Backups — Gestão Financeira"); se falhar, nada é alterado;
 *  2) por tabela: monta a aba nova ao lado da atual, relê e CONFERE campo a campo com o que o app enxergava;
 *     só então apaga a antiga e dá o nome certo à nova. Se a conferência não bater, a aba atual fica como estava;
 *  3) recarrega o cache.
 * A volta ("formato de colunas") faz o mesmo caminho ao contrário — a planilha volta a ser legível à mão.
 */
var CP = (function () {
  var TABS = Object.keys(D.ESQ).filter(function (t) { return D.ESQ[t].compactavel; });
  var NOMES_FMT = { compactado: 'compactado (2 colunas)', colunas: 'colunas (legível na planilha)', ausente: 'aba ainda não existe' };

  function situacao() {
    var ss = D.planilha();
    return TABS.map(function (t) {
      var e = D.ESQ[t], sh = ss.getSheetByName(e.aba);
      if (!sh) return { tabela: t, aba: e.aba, formato: 'ausente', formato_txt: NOMES_FMT.ausente, linhas: 0, celulas: 0 };
      D.esquecerFormato(t);
      var cp = D.compacta(t, sh), lr = sh.getLastRow(), lc = sh.getLastColumn(), f = cp ? 'compactado' : 'colunas';
      return { tabela: t, aba: e.aba, formato: f, formato_txt: NOMES_FMT[f], linhas: Math.max(lr - 1, 0), celulas: lr * lc };
    });
  }

  function copiaSeguranca(destino) {
    try {
      var it = DriveApp.getFoldersByName('Backups — Gestão Financeira'), pasta = it.hasNext() ? it.next() : DriveApp.createFolder('Backups — Gestão Financeira');
      var f = DriveApp.getFileById(D.prop('PLANILHA_ID')).makeCopy('antes_' + (destino === 'compactado' ? 'da_compactacao' : 'da_descompactacao') + '_' + D.hojeISO() + '_' + Utilities.formatDate(new Date(), APP.TZ, "HH'h'mm"), pasta);
      return f.getUrl ? f.getUrl() : '';
    } catch (e) { throw erro_(503, 'Não consegui fazer a cópia de segurança antes de converter (' + e.message + '). Nada foi alterado.'); }
  }

  /** O que o app enxerga hoje na aba (uma posição por coluna; valores já no tipo do sistema). Linhas sem ID ficam de fora. */
  function lerAtual(t, sh) {
    var e = D.ESQ[t], nn = e.nomes.length, vals = sh.getDataRange().getValues(), linhas, descartadas = 0;
    if (vals.length && vals[0].length >= 2 && D.ehCabCompacto(vals[0][1])) linhas = D.desempacotar(t, vals.slice(1));
    else {
      var cab = (vals[0] || []).map(function (x) { return String(x == null ? '' : x).trim(); }); while (cab.length < nn) cab.push('');   // títulos que faltam = em branco
      var norm = function (x) { return String(x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ''); };
      // título em branco ou escrito de outro jeito é a mesma coluna ; outro nome = colunas fora de ordem
      for (var j = 0; j < nn; j++) if (cab[j] !== '' && norm(cab[j]) !== norm(e.cab[j])) throw erro_(409, 'A aba ' + e.aba + ' está com o cabeçalho diferente do esperado (coluna ' + (j + 1) + ': "' + (cab[j] || '') + '", esperado "' + e.cab[j] + '"). Nada foi convertido nesta aba.');
      var extras = 0; vals.forEach(function (r, i) { if (i === 0) return; for (var k = nn; k < r.length; k++) if (r[k] !== '' && r[k] != null) { extras++; break; } });
      if (extras) throw erro_(409, 'A aba ' + e.aba + ' tem dados em colunas além das do app (' + extras + ' linha(s)). Elas se perderiam na conversão: confira a planilha. Nada foi convertido nesta aba.');
      linhas = vals.slice(1).map(function (r) {
        var row = r.slice(0, nn); while (row.length < nn) row.push('');
        return row.map(function (v, j2) { var c = D.conv(v, e.tipos[j2]); return c == null ? '' : c; });
      });
    }
    linhas = linhas.filter(function (r) {
      var temId = !(r[0] === '' || r[0] == null);
      if (!temId && r.some(function (v) { return v !== '' && v != null; })) descartadas++;   // sem ID o app nunca enxergou a linha (fica na cópia de segurança)
      return temId;
    });
    return { linhas: linhas, descartadas: descartadas, celulas: vals.length * (vals[0] || []).length };
  }

  function semLinha(o) { var c = {}; Object.keys(o).forEach(function (k) { if (k !== '_r') c[k] = o[k]; }); return c; }
  function iguais(t, a, b) {
    if (a.length !== b.length) return 'quantidade de registros (' + a.length + ' × ' + b.length + ')';
    var nomes = D.ESQ[t].nomes;
    for (var i = 0; i < a.length; i++) for (var j = 0; j < nomes.length; j++) {
      var x = a[i][nomes[j]], y = b[i][nomes[j]];
      if (!(x === y || (x == null && y == null))) return 'registro ' + a[i][nomes[0]] + ', campo ' + nomes[j] + ' ("' + x + '" × "' + y + '")';
    }
    return '';
  }

  /** Converte uma aba (atômico: a aba atual só é trocada depois de a nova conferir). */
  function converterTabela(ss, t, paraCP) {
    var e = D.ESQ[t], nn = e.nomes.length, sh = ss.getSheetByName(e.aba);
    var atual = lerAtual(t, sh), linhas = atual.linhas, antes = D.objetosDe(t, linhas).map(semLinha);
    var tmp = e.aba + '__nova', velha = ss.getSheetByName(tmp); if (velha) ss.deleteSheet(velha);   // sobra de uma tentativa interrompida
    var nv = ss.insertSheet(tmp, sh.getIndex());
    try {
      var larg = paraCP ? 2 : nn, n = linhas.length + 1;
      if (nv.getMaxColumns() < larg) nv.insertColumnsAfter(nv.getMaxColumns(), larg - nv.getMaxColumns());
      if (nv.getMaxColumns() > larg) nv.deleteColumns(larg + 1, nv.getMaxColumns() - larg);
      var nr = n + 100;   // 100 linhas de reserva (as gravações acrescentam mais quando precisam)
      if (nv.getMaxRows() < nr) nv.insertRowsAfter(nv.getMaxRows(), nr - nv.getMaxRows());
      if (nv.getMaxRows() > nr) nv.deleteRows(nr + 1, nv.getMaxRows() - nr);
      if (paraCP) nv.getRange(1, 1, nr, 2).setNumberFormat('@');
      else { nv.getRange(1, 1, 1, nn).setNumberFormat('@'); D.formatarTexto(nv, t, 2, nr - 1); }
      nv.getRange(1, 1, 1, larg).setValues([paraCP ? D.CAB_CP : e.cab]).setBackground(CABECALHO_COR_).setFontColor('#ffffff').setFontWeight('bold');
      nv.setFrozenRows(1);
      var fis = paraCP ? D.empacotar(t, linhas) : linhas;
      for (var i = 0; i < fis.length; i += 4000) { var parte = fis.slice(i, i + 4000); nv.getRange(2 + i, 1, parte.length, larg).setValues(parte); }
      SpreadsheetApp.flush();
      // confere: relê a aba nova pelo mesmo caminho do app e compara campo a campo
      var rv = nv.getDataRange().getValues(), depois;
      if (paraCP) { if (!(rv[0] && D.ehCabCompacto(rv[0][1]))) throw new Error('cabeçalho da aba nova'); depois = D.desempacotar(t, rv.slice(1)); }
      else depois = rv.slice(1).map(function (r) { var row = r.slice(0, nn); while (row.length < nn) row.push(''); return row; });
      depois = depois.filter(function (r) { return !(r[0] === '' || r[0] == null); });
      var dif = iguais(t, antes, D.objetosDe(t, depois).map(semLinha));
      if (dif) throw new Error('a conferência não bateu: ' + dif);
    } catch (er) {
      try { ss.deleteSheet(nv); } catch (e2) { /* ignora */ }
      throw erro_(500, 'Conversão da aba ' + e.aba + ' cancelada (' + (er.message || er) + '). Essa aba ficou exatamente como estava.');
    }
    ss.deleteSheet(sh); nv.setName(e.aba);   // a antiga continua na cópia de segurança
    D.esquecerFormato(t);
    return { tabela: t, aba: e.aba, registros: linhas.length, celulas_antes: atual.celulas, celulas_depois: n * larg, descartadas: atual.descartadas };
  }

  /** destino: 'compactado' | 'colunas'. Roda dentro da trava (rota que grava ou função do editor). */
  function converter(destino, quem) {
    if (destino !== 'compactado' && destino !== 'colunas') throw erro_(400, 'Formato inválido.');
    var paraCP = destino === 'compactado', ss = D.planilha();
    try { D.descarregarAuditoria(); } catch (e) { /* segue */ }
    D.esquecerFormato();
    var alvo = TABS.filter(function (t) { var sh = ss.getSheetByName(D.ESQ[t].aba); return sh && D.compacta(t, sh) !== paraCP; });
    if (!alvo.length) return { nada: true, destino: destino, situacao: situacao() };
    var backup = copiaSeguranca(destino), feitos = [], erro = null;
    try {
      for (var i = 0; i < alvo.length; i++) feitos.push(converterTabela(ss, alvo[i], paraCP));
    } catch (er) { erro = er; }
    finally { D.limparCache(); }   // todos passam a ler as abas novas (inclusive as já convertidas, se uma falhou)
    D.auditar(quem || 'sistema', paraCP ? 'Compactou as tabelas que crescem na planilha' : 'Voltou as tabelas ao formato de colunas', 'banco', destino,
      { feitos: feitos.map(function (f) { return f.aba + ' ' + f.registros; }), erro: erro ? erro.message : '', backup: backup });
    if (erro) { erro.message = erro.message + (feitos.length ? ' (já convertidas: ' + feitos.map(function (f) { return f.aba; }).join(', ') + '.)' : '') + ' Cópia de segurança: ' + backup; throw erro; }
    return { destino: destino, feitos: feitos, backup: backup, situacao: situacao() };
  }

  return { TABS: TABS, situacao: situacao, converter: converter };
})();

rota_('GET', '/api/banco/formato', {}, function () { return { tabelas: CP.situacao() }; });
rota_('POST', '/api/banco/formato', {}, function (c) { return CP.converter(c.body && c.body.destino, c.perfil.email); });

/** Pelo editor do Apps Script (conta proprietária): mesma conversão da tela Minha conta ▸ Planilha de dados. */
function compactarPlanilha() { return conversaoEditor_('compactado'); }
function descompactarPlanilha() { return conversaoEditor_('colunas'); }
function conversaoEditor_(destino) {
  exigirInterno_();
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    D.reiniciarMemoria(); D.rota('');
    var r = CP.converter(destino, Session.getEffectiveUser().getEmail());
    D.descarregarAuditoria(); D.fim();
    var msg = r.nada ? 'Nada a converter: as tabelas já estão no formato ' + destino + '.' : r.feitos.map(function (f) { return f.aba + ': ' + f.registros + ' registros, ' + f.celulas_antes + ' → ' + f.celulas_depois + ' células' + (f.descartadas ? ' (' + f.descartadas + ' linha(s) sem ID ficaram só na cópia)' : ''); }).join('\n') + '\nCópia de segurança: ' + r.backup;
    console.log(msg); return msg;
  } finally { lock.releaseLock(); }
}
