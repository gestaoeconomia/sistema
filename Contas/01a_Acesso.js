/**
 * Autenticação — somente e-mail + senha (sem login pela conta Google):
 *  • cadastro: a própria pessoa informa nome, e-mail e cria a senha; o acesso é liberado na hora.
 *    O app aceita no máximo 2 contas (o casal). Se a propriedade EMAILS_PERMITIDOS estiver preenchida
 *    (ver instalar()), só esses e-mails conseguem se cadastrar;
 *  • senha guardada só como hash com sal nas propriedades do script (nunca na planilha);
 *  • sessão: ao entrar, o servidor gera uma chave aleatória (guardada só como hash no CacheService, 6 h renováveis)
 *    que o navegador envia a cada chamada. Não depende de conta Google: funciona com ou sem login no Google
 *    (Session.getTemporaryActiveUserKey() vem vazio para visitantes sem conta, por isso não é usado);
 *  • "manter-me conectado": token aleatório guardado só como hash (30 dias deslizantes, até 5 dispositivos);
 *  • limites de tentativas por sessão e por e-mail; ações registradas na auditoria.
 */
var A = (function () {
  var SESSAO_S = 21600, MANTER_MS = 30 * 86400000, MANTER_MAX = 5, PREF_MANTER = 'cc_manter_';
  var perfilMemo;

  function hash(valor) {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(valor), Utilities.Charset.UTF_8)
      .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  }
  function props() { return PropertiesService.getScriptProperties(); }
  var tokenAtual = '';
  /** Chave de sessão enviada pelo navegador nesta chamada (definida pelo api() em 01_Web.js). */
  function usarToken(t) { tokenAtual = typeof t === 'string' && t.length >= 60 && t.length <= 200 ? t : ''; esquecerPerfil(); }
  function chaveSessao(t) { t = t === undefined ? tokenAtual : t; return t ? 'cc_sess_v2_' + hash('sessao:' + t) : ''; }
  /** "Versão" das sessões de cada pessoa: redefinir a senha incrementa e derruba as sessões abertas dela. */
  function versaoSessao(email) { return String(props().getProperty('cc_sv_' + hash(email)) || '0'); }

  // ---------- senha (hash com sal) ----------
  var ITERACOES = 300;
  function chaveSenha(email) { return 'cc_pw_' + hash(email); }
  function hex(bytes) { return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join(''); }
  function derivar(senha, sal, n) { // HMAC-SHA256 encadeado com sal; o número de voltas fica gravado junto do hash
    var h = String(senha);
    for (var i = 0; i < n; i++) h = hex(Utilities.computeHmacSha256Signature(h + '|' + i, sal + '|' + senha));
    return h;
  }
  function senhaForte(s) { return typeof s === 'string' && s.length >= 8 && s.length <= 200 && /[A-Za-z]/.test(s) && /\d/.test(s); }
  function guardarSenha(email, senha) { var sal = Utilities.getUuid(); props().setProperty(chaveSenha(email), ITERACOES + '$' + sal + '$' + derivar(senha, sal, ITERACOES)); }
  function confereSenha(email, senha) {
    var g = String(props().getProperty(chaveSenha(email)) || '').split('$'); if (g.length !== 3 || typeof senha !== 'string') return false;
    var calc = derivar(senha, g[1], Number(g[0]) || ITERACOES), ref = g[2], d = calc.length ^ ref.length;
    for (var i = 0; i < ref.length; i++) d |= calc.charCodeAt(i) ^ ref.charCodeAt(i);
    return d === 0;
  }
  function temSenhaLocal(email) { return !!props().getProperty(chaveSenha(email)); }
  function usuarioAtivo(email) {
    email = String(email || '').trim().toLowerCase(); if (!email) return null;
    var u = D.porId('usuarios', email); return u && u.ativo === 1 ? u : null;
  }

  // ---------- sessão ----------
  /** Abre uma sessão nova e devolve a chave que o navegador deve guardar. */
  function cacheSessao(email) {
    var t = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    CacheService.getScriptCache().put(chaveSessao(t), JSON.stringify({ email: email, v: versaoSessao(email), ts: Date.now() }), SESSAO_S);
    tokenAtual = t; return t;
  }
  function emailAtual() {
    var k = chaveSessao(); if (!k) return '';
    try {
      var c = CacheService.getScriptCache(), bruto = c.get(k); if (!bruto) return '';
      var s = JSON.parse(bruto), email = String((s && s.email) || '').trim().toLowerCase();
      if (!email || !P.emailValido(email) || !temSenhaLocal(email) || String(s.v) !== versaoSessao(email)) return '';
      if (Date.now() - Number(s.ts || 0) > 600000) { s.ts = Date.now(); c.put(k, JSON.stringify(s), SESSAO_S); } // renovação deslizante (a cada 10 min de uso)
      return email;
    } catch (e) { return ''; }
  }
  /** Perfil do usuário atual (null se não identificado ou desativado). */
  function perfilAtual() {
    if (perfilMemo !== undefined) return perfilMemo;
    var u = usuarioAtivo(emailAtual()); perfilMemo = u ? P.perfilDe(u) : null; return perfilMemo;
  }
  function esquecerPerfil() { perfilMemo = undefined; }

  // ---------- limites de frequência ----------
  function limitarFrequencia(escopo, id, limite, janelaS, msg) {
    var cache = CacheService.getScriptCache(), chave = 'rl_v1_' + hash(escopo + '|' + (id || 'anon')), agora = Date.now(), dados = null;
    try { dados = JSON.parse(cache.get(chave) || 'null'); } catch (e) { dados = null; }
    if (!dados || agora >= dados.expira) dados = { n: 0, expira: agora + janelaS * 1000 };
    if (dados.n >= limite) throw erro_(429, msg || 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.');
    dados.n++; cache.put(chave, JSON.stringify(dados), Math.max(1, Math.ceil((dados.expira - agora) / 1000)));
  }

  function registrarEntrada(u) { u.ultimo_acesso = D.agoraISO(); D.atualizar('usuarios', u); D.auditar(u.email, 'Entrou no sistema', 'usuarios', u.email, null); }
  function entrar(email, senha, manter) {
    email = String(email || '').trim().toLowerCase();
    if (!P.emailValido(email) || typeof senha !== 'string' || !senha || senha.length > 4096) throw erro_(400, 'Confira seu e-mail e sua senha.');
    limitarFrequencia('entrar', 'todos', 60, 900, 'Muitas tentativas de entrada. Aguarde alguns minutos.');
    limitarFrequencia('senha_conta', email, 20, 900, 'Muitas tentativas para este e-mail. Aguarde 15 minutos e tente novamente.');
    var u = usuarioAtivo(email);
    if (!u || !confereSenha(email, senha)) throw erro_(401, 'E-mail ou senha não conferem.');
    var sessao = cacheSessao(email); registrarEntrada(u); esquecerPerfil();
    return { ok: true, perfil: P.perfilDe(u), sessao: sessao, token: manter === true ? criarSessaoPersistente(email) : null };
  }

  // ---------- "Manter-me conectado" ----------
  function chavePersistente(token) { return PREF_MANTER + hash('manter:' + token); }
  function criarSessaoPersistente(email) {
    var p = props(), token = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid(), agora = Date.now(), todas = p.getProperties(), doUsuario = [];
    Object.keys(todas).forEach(function (k) {
      if (k.indexOf(PREF_MANTER) !== 0) return;
      var d = null; try { d = JSON.parse(todas[k]); } catch (e) {}
      if (!d || agora >= Number(d.expiraEm || 0)) return p.deleteProperty(k);
      if (d.email === email) doUsuario.push({ k: k, criadoEm: Number(d.criadoEm || 0) });
    });
    doUsuario.sort(function (a, b) { return a.criadoEm - b.criadoEm; });
    while (doUsuario.length >= MANTER_MAX) p.deleteProperty(doUsuario.shift().k);
    p.setProperty(chavePersistente(token), JSON.stringify({ email: email, v: versaoSessao(email), criadoEm: agora, expiraEm: agora + MANTER_MS }));
    return token;
  }
  function retomar(token) {
    token = typeof token === 'string' ? token : '';
    if (token.length < 60 || token.length > 200) throw erro_(401, 'Sessão não encontrada.');
    limitarFrequencia('retomar', 'todos', 120, 900, 'Muitas tentativas. Aguarde alguns minutos.');
    var p = props(), chave = chavePersistente(token), d = null;
    try { d = JSON.parse(p.getProperty(chave) || 'null'); } catch (e) {}
    if (!d || Date.now() >= Number(d.expiraEm || 0)) { if (d) p.deleteProperty(chave); throw erro_(401, 'Sua sessão salva expirou. Entre novamente.'); }
    var email = String(d.email || '').toLowerCase(), u = usuarioAtivo(email);
    if (!u || !temSenhaLocal(email)) { p.deleteProperty(chave); throw erro_(401, 'Seu acesso não está mais ativo. Entre novamente.'); }
    if (d.v !== undefined && String(d.v) !== versaoSessao(email)) { p.deleteProperty(chave); throw erro_(401, 'Sua senha foi alterada. Entre novamente.'); }
    var sessao = cacheSessao(email); d.expiraEm = Date.now() + MANTER_MS; p.setProperty(chave, JSON.stringify(d)); // renovação deslizante
    u.ultimo_acesso = D.agoraISO(); D.atualizar('usuarios', u); esquecerPerfil();
    return { ok: true, perfil: P.perfilDe(u), sessao: sessao };
  }
  function sair(token) {
    var k = chaveSessao(); if (k) CacheService.getScriptCache().remove(k); tokenAtual = '';
    if (typeof token === 'string' && token.length >= 60 && token.length <= 200) props().deleteProperty(chavePersistente(token));
    esquecerPerfil(); return { ok: true };
  }
  function revogarSessoes(email) {
    var p = props(), todas = p.getProperties();
    p.setProperty('cc_sv_' + hash(email), String(Number(versaoSessao(email)) + 1)); // derruba as sessões abertas em todos os aparelhos
    Object.keys(todas).forEach(function (k) { if (k.indexOf(PREF_MANTER) !== 0) return; try { if (JSON.parse(todas[k]).email === email) p.deleteProperty(k); } catch (e) {} });
  }

  // ---------- senha: troca, redefinição ----------
  function alterarSenha(email, atual, nova) {
    limitarFrequencia('senha_troca', email, 10, 900, 'Muitas tentativas. Aguarde alguns minutos.');
    if (!senhaForte(nova)) throw erro_(400, 'A nova senha deve ter ao menos 8 caracteres, com letras e números.');
    if (temSenhaLocal(email) && !confereSenha(email, atual)) throw erro_(401, 'A senha atual não confere.');
    guardarSenha(email, nova); D.auditar(email, 'Alterou a própria senha', 'usuarios', email, null); return { ok: true };
  }
  /** Um redefine a senha do outro (quando alguém esquece). Exige a senha de quem está fazendo a troca. */
  function redefinirSenhaDoParceiro(meuEmail, minhaSenha, nova) {
    limitarFrequencia('senha_troca', meuEmail, 10, 900, 'Muitas tentativas. Aguarde alguns minutos.');
    var par = P.parceiroDe(meuEmail); if (!par) throw erro_(400, 'Ainda não há outra pessoa cadastrada.');
    if (!confereSenha(meuEmail, minhaSenha)) throw erro_(401, 'Sua senha não confere.');
    if (!senhaForte(nova)) throw erro_(400, 'A nova senha deve ter ao menos 8 caracteres, com letras e números.');
    guardarSenha(par.email, nova); revogarSessoes(par.email);
    D.auditar(meuEmail, 'Redefiniu a senha do(a) parceiro(a)', 'usuarios', par.email, null); return { ok: true, nome: par.nome };
  }
  /** Usado pela função redefinirSenha() do editor (14_Instalar.js). */
  function definirSenhaPeloEditor(email, senha) {
    email = String(email || '').trim().toLowerCase();
    if (!D.porId('usuarios', email)) throw new Error('Usuário não encontrado: ' + email);
    if (!senhaForte(senha)) throw new Error('A senha deve ter ao menos 8 caracteres, com letras e números.');
    guardarSenha(email, senha); revogarSessoes(email); D.auditar('editor', 'Senha redefinida pelo editor', 'usuarios', email, null);
  }

  // ---------- cadastro ----------
  function permitidos() { return String(props().getProperty('EMAILS_PERMITIDOS') || '').split(/[,;\s]+/).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean); }
  function cadastroAberto() { return P.ativos().length < APP.MAX_USUARIOS; }
  function cadastrar(b) {
    limitarFrequencia('cadastro', 'todos', 8, 3600);
    var email = String(b.email || '').trim().toLowerCase(), nome = U.texto(b.nome, 80);
    if (!P.emailValido(email)) throw erro_(400, 'Informe um e-mail válido.');
    if (nome.length < 2) throw erro_(400, 'Informe seu nome.');
    if (!senhaForte(b.senha)) throw erro_(400, 'Crie uma senha com ao menos 8 caracteres, com letras e números.');
    var ja = D.porId('usuarios', email);
    if (ja) throw erro_(409, 'Este e-mail já tem cadastro. Entre com sua senha.');
    if (!cadastroAberto()) throw erro_(403, 'O cadastro está fechado: o app já tem as duas contas do casal.');
    var lista = permitidos(); if (lista.length && lista.indexOf(email) < 0) throw erro_(403, 'Este e-mail não está autorizado a se cadastrar neste app.');
    D.inserir('usuarios', { email: email, nome: nome, ativo: 1, criado_em: D.agoraISO(), ultimo_acesso: '' });
    guardarSenha(email, b.senha);
    D.auditar(email, 'Criou a conta', 'usuarios', email, { nome: nome });
    return { ok: true, mensagem: 'Conta criada. Agora é só entrar com seu e-mail e senha.' };
  }

  return {
    usarToken: usarToken, temSenhaLocal: temSenhaLocal, perfilAtual: perfilAtual, esquecerPerfil: esquecerPerfil, entrar: entrar, retomar: retomar, sair: sair,
    alterarSenha: alterarSenha, redefinirSenhaDoParceiro: redefinirSenhaDoParceiro, definirSenhaPeloEditor: definirSenhaPeloEditor, revogarSessoes: revogarSessoes,
    cadastrar: cadastrar, cadastroAberto: cadastroAberto, limitarFrequencia: limitarFrequencia, hash: hash
  };
})();
