/**
 * V1.3 — Site do app (GitHub Pages). O site da pasta docs/ fala com este Apps Script pelo link /exec (docs/config.js).
 * Em "Minha conta ▸ Site do app" um dos dois grava o endereço do site (URL_EXTERNA). A partir daí, os e-mails de aviso
 * levam para o site, e não para o link do Apps Script (que pede conta Google e quebra com várias contas no celular).
 */
var ACESSO_EXT = (function () {
  function info() { var p = D.props(); return { url: urlApp_(), externa: String(p.getProperty('URL_EXTERNA') || '') || null, versao: APP.VERSAO }; }
  function salvar(b, email) {
    var u = String(b.externa || '').trim(), p = D.props();
    if (u && !/^https:\/\/[^\s<>"']{4,400}$/i.test(u)) throw erro_(400, 'Site do app: informe um endereço que comece com https://');
    if (u) p.setProperty('URL_EXTERNA', u); else p.deleteProperty('URL_EXTERNA');
    D.propLocal('URL_EXTERNA', u || null);   // V1.4: o retrato das propriedades desta requisição fica igual ao gravado
    D.auditar(email, u ? 'Cadastrou o endereço do site do app' : 'Removeu o endereço do site do app', 'config', 'URL_EXTERNA', { url: u || null });
    return info();
  }
  return { info: info, salvar: salvar };
})();
rota_('GET', '/api/acesso-externo', {}, function () { return ACESSO_EXT.info(); });
rota_('PUT', '/api/acesso-externo', {}, function (c) { return ACESSO_EXT.salvar(c.body || {}, c.perfil.email); });
