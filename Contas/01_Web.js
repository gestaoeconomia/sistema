/**
 * Entrada do aplicativo (doGet), include() dos arquivos de tela e API única (api) chamada pelo navegador via google.script.run.
 * O front-end envia { m: 'GET|POST|PUT|DELETE', u: '/api/...?query', b: corpo JSON, raw: arquivo em base64 (PDF da fatura), t: chave da sessão }
 * e recebe { s: status, d: dados } ou { s: 200, f: { nome, tipo, b64 } } para arquivos.
 */
function include(nome) { return HtmlService.createHtmlOutputFromFile(nome).getContent(); }

function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  t.versao = APP.VERSAO;
  var out = t.evaluate().setTitle(APP.TITULO)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1') // o Apps Script só aceita algumas metatags aqui: não acrescente outras
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  try { var ic = urlIcone_(); if (ic) out.setFaviconUrl(ic); } catch (e) { console.warn('Ícone da aba não aplicado: ' + e.message); } // sem ícone, a página abre do mesmo jeito
  return out;
}
/**
 * Ícone da aba: link público do PNG criado no Drive por criarIcone() (ou ICONE_URL, se você preferir outro endereço).
 * O setFaviconUrl só aceita endereços que TERMINAM com o tipo da imagem ("png"); por isso o "&format=png" no fim.
 */
function urlIcone_() {
  var p = PropertiesService.getScriptProperties(), url = p.getProperty('ICONE_URL'), id = p.getProperty('ICONE_ID');
  return url || (id ? 'https://drive.google.com/uc?id=' + id + '&export=download&format=png' : '');
}

/**
 * Mesma API, chamada por fetch a partir das telas hospedadas fora do Google (site estático — ver LEIA-ME).
 * O navegador envia sem cookies da conta Google (credentials: 'omit'), então funciona com qualquer conta logada.
 * Corpo: o mesmo objeto { m, u, b, raw, t } do google.script.run.api(...), como texto JSON.
 */
function doPost(e) {
  var res;
  try { res = api(JSON.parse(e && e.postData && e.postData.contents || 'null')); } catch (x) { res = { s: 400, d: { erro: 'Requisição inválida.' } }; }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

var ROTAS_ = [];
function rota_(metodo, rx, opts, fn) { ROTAS_.push({ metodo: metodo, rx: new RegExp('^' + rx + '$'), opts: opts || {}, fn: fn }); }
function analisarUrl_(u) {
  var i = u.indexOf('?'), q = {};
  if (i >= 0) u.slice(i + 1).split('&').forEach(function (p) {
    if (!p) return; var k = p.indexOf('='); q[decodeURIComponent(k < 0 ? p : p.slice(0, k))] = k < 0 ? '' : decodeURIComponent(p.slice(k + 1));
  });
  return { path: i < 0 ? u : u.slice(0, i), query: q };
}

/** Único ponto de entrada chamado pelo navegador. Nunca lança exceção: devolve { s, d }. */
function api(req) {
  var travou = false, lock = null;
  try {
    D.reiniciarMemoria(); A.usarToken(req && req.t);
    if (!req || typeof req !== 'object' || typeof req.u !== 'string' || ['GET', 'POST', 'PUT', 'DELETE'].indexOf(req.m) < 0 || req.u.indexOf('/api/') !== 0 || req.u.length > 4000) throw erro_(400, 'Requisição inválida.');
    if (typeof req.raw === 'string' && req.raw.length > 4e6) throw erro_(413, 'Arquivo grande demais (limite de ~2 MB).');
    var url = analisarUrl_(req.u), alvo = null, args = [];
    for (var i = 0; i < ROTAS_.length; i++) {
      var r = ROTAS_[i]; if (r.metodo !== req.m) continue; var m = url.path.match(r.rx);
      if (m) { alvo = r; args = m.slice(1).map(function (x) { return decodeURIComponent(x); }); break; }
    }
    if (!alvo) throw erro_(404, 'Rota não encontrada.');
    var perfil = A.perfilAtual();
    if (!alvo.opts.publica && !perfil) throw erro_(401, 'Sessão expirada. Entre novamente.');
    var c = { perfil: perfil, url: url, query: url.query, body: (req.b && typeof req.b === 'object') ? req.b : {}, raw: typeof req.raw === 'string' ? req.raw : null };
    if (req.m !== 'GET' || alvo.opts.escreve) {
      lock = LockService.getScriptLock();
      try { lock.waitLock(30000); travou = true; } catch (e) { throw erro_(503, 'O sistema está ocupado com outra gravação. Tente novamente em instantes.'); }
      D.reiniciarMemoria(); A.esquecerPerfil(); c.perfil = A.perfilAtual();
      if (!alvo.opts.publica && !c.perfil) throw erro_(401, 'Sessão expirada. Entre novamente.');
    }
    var res = alvo.fn.apply(null, [c].concat(args));
    D.descarregarAuditoria();
    if (res && res.__arquivo) return { s: 200, f: { nome: res.nome, tipo: res.tipo, b64: res.b64 } };
    return JSON.parse(JSON.stringify({ s: 200, d: res === undefined ? { ok: true } : res })); // só JSON puro volta ao navegador
  } catch (e) {
    var st = e && e.status ? e.status : 500;
    if (st === 500) { try { console.error(String(e && e.stack || e)); } catch (_) {} }
    try { D.descarregarAuditoria(); } catch (_) {}
    var d = { erro: st === 500 && !(e && e.codigo) ? 'Erro interno. Tente novamente.' : e.message };
    if (e && e.codigo) d.codigo = e.codigo;
    if (st === 500) { try { if (PropertiesService.getScriptProperties().getProperty('DEBUG') === '1') d.erro += ' [' + String(e && e.message || e).slice(0, 300) + ']'; } catch (_) {} }
    return { s: st, d: d };
  } finally { if (travou && lock) { try { lock.releaseLock(); } catch (_) {} } }
}