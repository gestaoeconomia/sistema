/**
 * Instalação e manutenção — execute estas funções pelo editor do Apps Script (conta proprietária).
 * Ordem: 1) preencha EMAILS_DO_CASAL (e, se importou a planilha pronta, PLANILHA_ID_EXISTENTE) abaixo  2) instalar()  3) Implantar > Nova implantação > App da Web
 *        4) (opcional) criarAcionadorBackup()
 * O instalar() também agenda os avisos por e-mail (todo dia às 8h). Pode ser executado de novo sem perder dados.
 */

/** E-mails que podem criar conta no app (o seu e o da sua esposa). Deixe vazio para aceitar os 2 primeiros cadastros. */
var EMAILS_DO_CASAL = ['', ''];
/**
 * Se você importou a planilha pronta (ContasDaCasa_BancoDeDados.xlsx) para o Google Drive, cole aqui o ID dela
 * (o trecho entre /d/ e /edit no endereço). Deixe vazio para o instalar() criar uma planilha nova.
 */
var PLANILHA_ID_EXISTENTE = '';

function exigirInterno_(e) {
  var ok = false;
  try { if (e && e.triggerUid) ok = ScriptApp.getProjectTriggers().some(function (t) { return String(t.getUniqueId()) === String(e.triggerUid); }); } catch (x) {}
  if (!ok) {
    var ativo = String(Session.getActiveUser().getEmail() || '').toLowerCase(), dono = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
    ok = !!ativo && !!dono && ativo === dono;
  }
  if (!ok) throw new Error('Esta função só pode ser executada pelo editor do Apps Script, com a conta proprietária.');
}

var CABECALHO_COR_ = '#334155';
function prepararAba_(ss, nome, colunas, primeira) {
  var sh = ss.getSheetByName(nome);
  if (!sh) { if (primeira && ss.getSheets().length === 1 && ss.getSheets()[0].getLastRow() === 0 && /^(Sheet1|Planilha1|Página1)$/i.test(ss.getSheets()[0].getName())) { sh = ss.getSheets()[0]; sh.setName(nome); } else sh = ss.insertSheet(nome); }
  var n = colunas.length;
  if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
  var t = Object.keys(D.ESQ).filter(function (k) { return D.ESQ[k].aba === nome; })[0];
  sh.getRange(1, 1, 1, n).setNumberFormat('@'); if (t) D.formatarTexto(sh, t, 2, sh.getMaxRows() - 1); // só as colunas de texto
  sh.getRange(1, 1, 1, n).setValues([colunas]).setBackground(CABECALHO_COR_).setFontColor('#ffffff').setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}
function leiaMe_(ss) {
  var sh = ss.getSheetByName('LEIA-ME') || ss.insertSheet('LEIA-ME', 0);
  sh.clear();
  var linhas = [
    ['Gestão Financeira — banco de dados'],
    [''],
    ['Esta planilha é o BANCO DE DADOS do aplicativo (Google Apps Script). Cada aba é uma tabela; a linha 1 é o cabeçalho.'],
    ['• Use o aplicativo para lançar e alterar. Edições manuais são possíveis, mas respeite os IDs (CAR-001, CMP-000001, GAS-000001, REC-0001, GAN-0001, MET-001, APO-000001, ACE-00001), datas AAAA-MM-DD e meses AAAA-MM.'],
    ['• Não renomeie abas nem colunas, não reordene colunas e não deixe linhas em branco no meio dos dados.'],
    ['• Alterações feitas direto na planilha podem levar até 10 minutos para aparecer no app (cache); para forçar, execute limparCache() no editor.'],
    ['• Senhas NÃO ficam aqui: ficam só como hash nas propriedades do script.'],
    ['• Parcelas não são gravadas: o app calcula cada parcela a partir de COMPRAS_CARTAO (primeira_fatura + nº de parcelas).'],
    ['• Faça backup: execute criarAcionadorBackup() para copiar esta planilha todo dia de madrugada.'],
    [''],
    ['• Gastos fixos (RECORRENTES) também não são copiados: entram em cada mês de inicio até fim (vazio = sem fim).'],
    [''],
    ['• Metas (METAS) e depósitos nas metas (META_APORTES): o app calcula quanto guardar por mês a partir delas.'],
    [''],
    ['• LIMITES: teto mensal por categoria de cada pessoa. GASTOS_PIX_DEBITO.ref_externa marca o que veio de extrato importado (evita importar duas vezes).'],
    [''],
    ['• NOTIFICACOES: avisos para o(a) parceiro(a) quando uma compra ou pix dividido é lançado, alterado ou excluído (lida_em vazio = ainda não vista).'],
    [''],
    ['Abas: USUARIOS · CARTOES · COMPRAS_CARTAO · FATURAS · GASTOS_PIX_DEBITO · RECORRENTES · GANHOS · METAS · META_APORTES · ACERTOS · LIMITES · NOTIFICACOES · AUDITORIA · CONFIG']
  ];
  sh.getRange(1, 1, linhas.length, 1).setValues(linhas).setWrap(true); sh.setColumnWidth(1, 900); sh.getRange(1, 1).setFontWeight('bold').setFontSize(14).setFontColor(CABECALHO_COR_);
}

/** Cria a planilha de dados (ou completa as abas que faltam, sem apagar nada) e grava os e-mails permitidos. */
function instalar() {
  exigirInterno_();
  var p = D.props(), id = p.getProperty('PLANILHA_ID') || String(PLANILHA_ID_EXISTENTE || '').trim(), ss;
  if (id) { ss = SpreadsheetApp.openById(id); p.setProperty('PLANILHA_ID', id); if (/^Contas da Casa/.test(ss.getName())) ss.rename(ss.getName().replace(/^Contas da Casa/, 'Gestão Financeira')); }
  else { ss = SpreadsheetApp.create('Gestão Financeira — banco de dados'); id = ss.getId(); p.setProperty('PLANILHA_ID', id); }
  D.reiniciarMemoria(); try { if (ss.getSpreadsheetTimeZone() !== APP.TZ) ss.setSpreadsheetTimeZone(APP.TZ); } catch (e) { /* segue */ }
  var primeira = true;
  Object.keys(D.ESQ).forEach(function (t) { var e = D.ESQ[t]; prepararAba_(ss, e.aba, e.nomes, primeira); primeira = false; });
  leiaMe_(ss);
  var lista = EMAILS_DO_CASAL.map(function (x) { return String(x || '').trim().toLowerCase(); }).filter(function (x) { return P.emailValido(x); });
  if (lista.length) p.setProperty('EMAILS_PERMITIDOS', lista.join(',')); else p.deleteProperty('EMAILS_PERMITIDOS');
  D.reiniciarMemoria(); D.garantirCabecalho('gastos'); D.auditar('sistema', 'Instalação', 'config', null, null); D.descarregarAuditoria(); D.limparCache();
  var avisos; try { avisos = criarAcionadorAvisos(); } catch (e) { avisos = 'Avisos por e-mail NÃO agendados: ' + e.message; }
  var icone; try { icone = criarIcone(); } catch (e) { icone = 'Ícone da aba NÃO criado: ' + e.message; }
  var msg = ['Instalação concluída.', 'Planilha de dados: ' + ss.getUrl(), avisos, icone,
    lista.length ? 'Cadastro liberado só para: ' + lista.join(', ') : 'Atenção: EMAILS_DO_CASAL está vazio — as 2 primeiras pessoas que se cadastrarem ficam com as contas.',
    'Próximo passo: Implantar > Nova implantação > App da Web (executar como: você; quem pode acessar: qualquer pessoa).'].join('\n');
  console.log(msg); return msg;
}
/** Se alguém esquecer a senha e o outro não puder redefinir pelo app: preencha e execute pelo editor. */
function redefinirSenha() {
  exigirInterno_();
  var EMAIL = '', NOVA_SENHA = ''; // preencha, execute e depois APAGUE a senha daqui
  A.definirSenhaPeloEditor(EMAIL, NOVA_SENHA); D.descarregarAuditoria(); return 'Senha redefinida para ' + EMAIL + '.';
}
function limparCache() { exigirInterno_(); D.limparCache(); return 'Cache limpo.'; }
function diagnostico() {
  exigirInterno_(); D.reiniciarMemoria(); var p = D.props(), o = {};
  o.planilha = p.getProperty('PLANILHA_ID') ? 'ok' : 'NÃO CRIADA (execute instalar())';
  o.emails_permitidos = p.getProperty('EMAILS_PERMITIDOS') || '(qualquer e-mail, até 2 contas)';
  if (p.getProperty('PLANILHA_ID')) Object.keys(D.ESQ).forEach(function (t) { try { o['linhas_' + t] = D.todos(t).length; } catch (e) { o['linhas_' + t] = 'ERRO: ' + e.message; } });
  try { o.url_app = urlApp_() || '(ainda não implantado)'; o.link_publico = linkPublico_(); } catch (e) { o.url_app = '?'; }
  console.log(JSON.stringify(o, null, 2)); return o;
}
/** Cópia diária da planilha de dados na pasta "Backups — Gestão Financeira" do Drive (mantém as últimas 30). */
function backupAgora(e) {
  exigirInterno_(e); var id = D.props().getProperty('PLANILHA_ID'); if (!id) return 'sem planilha';
  var it = DriveApp.getFoldersByName('Backups — Gestão Financeira'), antiga = DriveApp.getFoldersByName('Backups — Contas da Casa'), pasta;
  if (it.hasNext()) pasta = it.next(); else if (antiga.hasNext()) { pasta = antiga.next(); pasta.setName('Backups — Gestão Financeira'); } else pasta = DriveApp.createFolder('Backups — Gestão Financeira');
  acertarFusoPlanilha_(); // V1.2 (do SIG V6.5.6): a planilha sempre no horário do Recife
  DriveApp.getFileById(id).makeCopy('backup_' + D.hojeISO() + '_' + Utilities.formatDate(new Date(), APP.TZ, "HH'h'mm"), pasta); // V1.2: hora do Recife (antes saía a de Londres)
  var arqs = [], f = pasta.getFiles(); while (f.hasNext()) arqs.push(f.next());
  arqs.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); }).slice(30).forEach(function (x) { x.setTrashed(true); });
  return 'Backup criado.';
}
/** Fuso da planilha de dados = America/Recife (datas digitadas direto na planilha não "pulam" um dia). */
function acertarFusoPlanilha_() { try { var ss = D.planilha(); if (ss.getSpreadsheetTimeZone() !== APP.TZ) ss.setSpreadsheetTimeZone(APP.TZ); } catch (e) { console.warn('Fuso da planilha: ' + e.message); } }
/** Confere o fuso do projeto e da planilha (V1.2, do SIG diagnosticarFuso). Rode no editor. */
function diagnosticarFuso() {
  exigirInterno_(); var proj = Session.getScriptTimeZone(), pl = ''; try { pl = D.planilha().getSpreadsheetTimeZone(); } catch (e) { pl = '(sem planilha)'; }
  var msg = 'Projeto: ' + proj + (proj === APP.TZ ? ' ✓' : ' ✗ (Configurações do projeto ▸ Fuso horário ▸ ' + APP.TZ + ')') + '\nPlanilha: ' + pl + (pl === APP.TZ ? ' ✓' : ' ✗ (rode backupAgora ou instalar para acertar)');
  console.log(msg); return msg;
}
function criarAcionadorBackup() {
  exigirInterno_();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'backupAgora') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('backupAgora').timeBased().everyDays(1).atHour(2).create(); return 'Backup diário agendado (2h).';
}
/** Agenda os avisos por e-mail: lembretes de vencimento, limites, acerto e o resumo do dia 1º (todo dia às 8h). */
function criarAcionadorAvisos() {
  exigirInterno_();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'avisosDiarios') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('avisosDiarios').timeBased().everyDays(1).atHour(8).inTimezone(APP.TZ).create();
  MailApp.getRemainingDailyQuota(); // pede a autorização de envio de e-mail já na instalação
  return 'Avisos por e-mail agendados (todo dia às 8h).';
}
/** Envia agora os avisos de hoje (os mesmos do acionador) — útil para testar pelo editor. */
function enviarAvisosAgora() { exigirInterno_(); var r = AV.rodar(); console.log(r.join('\n') || 'Nada a avisar hoje.'); return r; }

/** V1.2: o ícone da aba é publicado sozinho na 1ª abertura (01b_Icone.js). criarIcone() força a recriação agora. */
function criarIcone() {
  exigirInterno_();
  var p = D.props(); p.deleteProperty('ICONE_ARQUIVO_VERSAO'); p.deleteProperty('ICONE_PUBLICO_VERSAO');
  try { CacheService.getScriptCache().remove('icone_url_v' + ICONE_VERSAO_); } catch (e) { /* ignora */ }
  iconeMemo_ = '';
  return 'Ícone da aba publicado: ' + urlIcone_() + '. Abra o link do app numa aba nova (o navegador guarda o ícone antigo por um tempo).';
}
/** Nome antigo, mantido: confere o ícone da aba (mesmo que diagnosticarIcone). */
function testarIcone() { return diagnosticarIcone(); }
