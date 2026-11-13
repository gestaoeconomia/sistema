/** Rotas da API (cada rota_ registra método, caminho, opções e função). A infraestrutura (doGet, api, rota_) está em 01_Web.js. */
function limpo_(o) { var r = {}; Object.keys(o).forEach(function (k) { if (k !== '_r') r[k] = o[k]; }); return r; }
function copia_(o) { var r = {}; Object.keys(o).forEach(function (k) { r[k] = o[k]; }); return r; }
function mesQuery_(q) { return U.mesValido(q.mes) ? q.mes : U.mesAtual(); }
function exigirDono_(dono, perfil, msg) { if (dono !== perfil.email) throw erro_(403, msg || 'Só quem lançou pode alterar ou excluir este registro.'); }
/**
 * PRIVACIDADE: cada um vê tudo o que é seu; do outro, só o que é dividido ou "todo do outro" (o que entra no acerto).
 * Ganhos e metas são do casal (os dois veem). No acerto, os totais gerais do outro (faturas e pix) ficam ocultos.
 */
function acertoPara_(ac, ve) { ac.pessoas.forEach(function (p) { if (p.email !== ve) { p.cartao.total = null; p.pix.total = null; } }); return ac; }
function exigirVisivel_(dono, divisao, perfil, oQue) { if (!R.visivel(dono, divisao, perfil.email)) throw erro_(404, oQue + ' não encontrado(a).'); }

// ---------- rotas públicas e de sessão ----------
rota_('GET', '/api/config', { publica: true }, function () { var aberto = true; try { aberto = A.cadastroAberto(); } catch (e) { /* planilha ainda não instalada */ } return { cadastro_aberto: aberto, versao: APP.VERSAO }; });
rota_('POST', '/api/auth/entrar', { publica: true }, function (c) { var r = A.entrar(c.body.email, c.body.senha, c.body.manter === true); return { ok: true, sessao: r.sessao, token: r.token, perfil: r.perfil }; });
rota_('POST', '/api/auth/retomar', { publica: true }, function (c) { return A.retomar(c.body.token); });
rota_('POST', '/api/auth/sair', { publica: true }, function (c) { return A.sair(c.body.token); });
rota_('POST', '/api/cadastro', { publica: true }, function (c) { return A.cadastrar(c.body); });
rota_('GET', '/api/eu', { publica: true }, function (c) { return { perfil: c.perfil || null }; });

// ---------- conta ----------
rota_('POST', '/api/auth/alterar-senha', {}, function (c) { return A.alterarSenha(c.perfil.email, c.body.atual, c.body.nova); });
rota_('POST', '/api/auth/redefinir-parceiro', {}, function (c) { return A.redefinirSenhaDoParceiro(c.perfil.email, c.body.minha_senha, c.body.nova); });
rota_('PUT', '/api/conta', {}, function (c) {
  var u = copia_(D.porId('usuarios', c.perfil.email)), nome = U.texto(c.body.nome, 80);
  if (nome.length < 2) throw erro_(400, 'Informe seu nome.');
  u.nome = nome; D.atualizar('usuarios', u); D.auditar(c.perfil.email, 'Alterou o nome', 'usuarios', u.email, { nome: nome });
  A.esquecerPerfil(); return { perfil: A.perfilAtual() };
});

rota_('GET', '/api/dominios', {}, function () {
  return {
    usuarios: P.ativos().map(function (u) { return { email: u.email, nome: u.nome, apelido: P.primeiroNome(u.nome) }; }),
    cartoes: D.todos('cartoes').map(function (x) { var o = limpo_(x); o.rotulo = R.nomeCartao(x); o.titular_nome = P.nomeDe(x.titular); return o; })
      .sort(function (a, b) { return b.ativo - a.ativo || a.rotulo.localeCompare(b.rotulo, 'pt-BR'); }),
    categorias: R.categorias(), hoje: D.hojeISO(), mes_atual: U.mesAtual()
  };
});

// ---------- resumo (início) ----------
rota_('GET', '/api/resumo', {}, function (c) {
  var ve = c.perfil.email, mes = mesQuery_(c.query), ac = R.acerto(mes), fat = R.faturasDoMes(mes, ve);
  var pix = D.todos('gastos').filter(function (g) { return String(g.data).slice(0, 7) === mes && g.pago_por === ve; }).concat(R.gastosFixosDoMes(mes, ve).filter(function (g) { return g.pago_por === ve; }))
    .reduce(function (s, g) { return s + U.centavos(g.valor); }, 0);
  var cart = fat.filter(function (f) { return f.titular === ve; }); // só você: as faturas do outro são dele
  var pessoas = [{ email: ve, nome: c.perfil.nome, faturas: cart, total_faturas: U.reais(cart.reduce(function (s, f) { return s + U.centavos(f.total); }, 0)), total_pix: U.reais(pix) }];
  var fim = R.parcelamentos(mes, '', ve).filter(function (p) { return p.ultima_fatura === mes; });
  return { mes: mes, rotulo: U.rotuloMes(mes), pessoas: pessoas, acerto: { devido: ac.devido, pago: ac.pago, restante_abs: ac.restante_abs, devedor: ac.devedor, credor: ac.credor, pendente: ac.pendente, completo: ac.completo },
    projecao: R.projecao(mes, 6, ve), terminam: fim, aberto: R.historicoAcertos().aberto, metas: M.listar(mes) };
});

// ---------- cartões ----------
rota_('POST', '/api/cartoes', {}, function (c) {
  var v = R.validarCartao(c.body, null);
  if (D.todos('cartoes').some(function (x) { return x.titular === c.perfil.email && x.nome.toLowerCase() === v.nome.toLowerCase() && String(x.final || '') === v.final; })) throw erro_(409, 'Você já tem um cartão com este nome.');
  v.id = D.proximoId('CAR', 3); v.titular = c.perfil.email; v.criado_em = D.agoraISO(); D.inserir('cartoes', v);
  D.auditar(c.perfil.email, 'Cadastrou cartão', 'cartoes', v.id, { nome: v.nome }); return limpo_(v);
});
rota_('PUT', '/api/cartoes/(CAR-\\d+)', {}, function (c, id) {
  var at = D.porId('cartoes', id); if (!at) throw erro_(404, 'Cartão não encontrado.'); exigirDono_(at.titular, c.perfil, 'Só o titular altera o cartão.');
  var v = R.validarCartao(c.body, at), novo = copia_(at); Object.keys(v).forEach(function (k) { novo[k] = v[k]; });
  D.atualizar('cartoes', novo); D.auditar(c.perfil.email, 'Alterou cartão', 'cartoes', id, v); return limpo_(novo);
});
rota_('DELETE', '/api/cartoes/(CAR-\\d+)', {}, function (c, id) {
  var at = D.porId('cartoes', id); if (!at) throw erro_(404, 'Cartão não encontrado.'); exigirDono_(at.titular, c.perfil, 'Só o titular exclui o cartão.');
  if (D.todos('compras').some(function (x) { return x.cartao_id === id; }) || D.todos('recorrentes').some(function (x) { return x.cartao_id === id; })) {
    var novo = copia_(at); novo.ativo = 0; D.atualizar('cartoes', novo); D.auditar(c.perfil.email, 'Desativou cartão', 'cartoes', id, null);
    return { ok: true, desativado: true, mensagem: 'O cartão tem compras ou gastos fixos: foi desativado (o histórico das faturas continua). Encerre os gastos fixos dele em "Gastos fixos".' };
  }
  D.excluir('cartoes', at); D.auditar(c.perfil.email, 'Excluiu cartão', 'cartoes', id, limpo_(at)); return { ok: true };
});

// ---------- faturas ----------
rota_('GET', '/api/faturas', {}, function (c) { return { mes: mesQuery_(c.query), rotulo: U.rotuloMes(mesQuery_(c.query)), cartoes: R.faturasDoMes(mesQuery_(c.query), c.perfil.email) }; });
rota_('GET', '/api/faturas/(CAR-\\d+)', {}, function (c, id) { return R.faturaDetalhe(id, mesQuery_(c.query), c.perfil.email); });
rota_('PUT', '/api/faturas/(CAR-\\d+)/(\\d{4}-\\d{2})', {}, function (c, id, mes) {
  var car = D.porId('cartoes', id); if (!car) throw erro_(404, 'Cartão não encontrado.'); exigirDono_(car.titular, c.perfil, 'Só o titular marca a fatura como paga.');
  if (!U.mesValido(mes)) throw erro_(400, 'Mês inválido.');
  var chave = id + '|' + mes, st = D.porId('faturas', chave), paga = c.body.paga === true;
  var o = st ? copia_(st) : { id: chave, cartao_id: id, mes: mes };
  o.paga = paga ? 1 : 0; o.paga_em = paga ? D.hojeISO() : ''; o.paga_por = paga ? c.perfil.email : '';
  if (st) D.atualizar('faturas', o); else D.inserir('faturas', o);
  D.auditar(c.perfil.email, paga ? 'Marcou fatura como paga' : 'Desmarcou fatura paga', 'faturas', chave, null); return { ok: true, paga: paga };
});

// ---------- compras no cartão ----------
rota_('GET', '/api/compras/sugerir-fatura', {}, function (c) {
  var car = D.porId('cartoes', c.query.cartao_id); if (!car || !U.dataValida(c.query.data)) return { mes: null };
  var m = R.faturaSugerida(car, c.query.data); return { mes: m, rotulo: U.rotuloMes(m) };
});
rota_('GET', '/api/parcelamentos', {}, function (c) { return R.parcelamentos(mesQuery_(c.query), c.query.cartao_id || '', c.perfil.email); });
rota_('GET', '/api/compras/(CMP-\\d+)', {}, function (c, id) {
  var cp = D.porId('compras', id); if (!cp) throw erro_(404, 'Compra não encontrada.');
  var o = limpo_(cp), car = D.porId('cartoes', cp.cartao_id); exigirVisivel_(car ? car.titular : '', cp.divisao, c.perfil, 'Compra'); o.divisao_rotulo = car ? R.rotuloDivisao(cp.divisao, car.titular) : cp.divisao; o.parcelas_lista = R.parcelas(cp).map(function (p) { return { n: p.n, mes: p.mes, rotulo: U.rotuloMes(p.mes), valor: U.reais(p.c) }; }); return o;
});
rota_('POST', '/api/compras', {}, function (c) {
  var v = R.validarCompra(c.body, null, c.perfil);
  v.id = D.proximoId('CMP', 6); v.criado_por = c.perfil.email; v.criado_em = D.agoraISO(); D.inserir('compras', v);
  D.auditar(c.perfil.email, 'Lançou compra no cartão', 'compras', v.id, { descricao: v.descricao, valor: v.valor_total, parcelas: v.parcelas, divisao: v.divisao });
  return limpo_(v);
});
rota_('POST', '/api/faturas/ler-pdf', {}, function (c) {
  if (!c.raw) throw erro_(400, 'Nenhum arquivo recebido.');
  var r = IMP.lerPdf(c.raw, c.query.mes, c.query.cartao_id);
  D.auditar(c.perfil.email, 'Leu PDF de fatura', 'faturas', (c.query.cartao_id || '') + '|' + r.mes, { itens: r.itens.length, ignorados: r.ignorados.length });
  return r;
});
rota_('POST', '/api/faturas/ler-texto', {}, function (c) {
  var r = IMP.lerTexto(c.body.texto, c.query.mes, c.query.cartao_id);
  D.auditar(c.perfil.email, 'Leu PDF de fatura', 'faturas', (c.query.cartao_id || '') + '|' + r.mes, { itens: r.itens.length, ignorados: r.ignorados.length, via: 'navegador' });
  return r;
});
/** Troca rápida da divisão de uma compra (marcar/desmarcar "dividido" direto na fatura). */
rota_('PUT', '/api/compras/(CMP-\\d+)/divisao', {}, function (c, id) {
  var at = D.porId('compras', id); if (!at) throw erro_(404, 'Compra não encontrada.');
  var car = D.porId('cartoes', at.cartao_id); exigirDono_(car && car.titular, c.perfil, 'Só o titular do cartão altera esta compra.');
  if (R.DIVISOES.indexOf(c.body.divisao) < 0) throw erro_(400, 'Divisão inválida.');
  var novo = copia_(at); novo.divisao = c.body.divisao; novo.atualizado_por = c.perfil.email; novo.atualizado_em = D.agoraISO(); D.atualizar('compras', novo);
  D.auditar(c.perfil.email, 'Mudou a divisão da compra', 'compras', id, { de: at.divisao, para: novo.divisao });
  return { ok: true, divisao: novo.divisao, divisao_rotulo: R.rotuloDivisao(novo.divisao, car.titular) };
});
/** Terceiro (alguém de fora do casal) que paga parte de uma compra; recebido = já pagou. */
rota_('PUT', '/api/compras/(CMP-\\d+)/terceiro', {}, function (c, id) {
  var at = D.porId('compras', id); if (!at) throw erro_(404, 'Compra não encontrada.');
  var car = D.porId('cartoes', at.cartao_id); exigirDono_(car && car.titular, c.perfil, 'Só o titular do cartão altera esta compra.');
  var t = R.validarTerceiro({ terceiro: c.body.terceiro || '', terceiro_valor: c.body.terceiro_valor, terceiro_recebido: c.body.terceiro_recebido }, null, U.centavos(at.valor_total));
  var novo = copia_(at); Object.keys(t).forEach(function (k) { novo[k] = t[k]; }); novo.atualizado_por = c.perfil.email; novo.atualizado_em = D.agoraISO(); D.atualizar('compras', novo);
  D.auditar(c.perfil.email, t.terceiro ? 'Definiu terceiro na compra' : 'Removeu terceiro da compra', 'compras', id, { terceiro: t.terceiro, valor: t.terceiro_valor, recebido: t.terceiro_recebido, divisao: at.divisao });
  return limpo_(novo);
});
/** Compras dos seus cartões que têm terceiro (quem deve, quanto, se já pagou). */
rota_('GET', '/api/terceiros', {}, function (c) {
  var meus = {}; D.todos('cartoes').forEach(function (x) { if (x.titular === c.perfil.email) meus[x.id] = x; });
  var itens = D.todos('compras').filter(function (cp) { return meus[cp.cartao_id] && R.terceiroDe(cp) > 0; }).map(function (cp) {
    return { id: cp.id, descricao: cp.descricao, data_compra: cp.data_compra, cartao: R.nomeCartao(meus[cp.cartao_id]), terceiro: cp.terceiro, terceiro_valor: cp.terceiro_valor, valor_total: cp.valor_total, parcelas: cp.parcelas, recebido: cp.terceiro_recebido === 1 };
  }).sort(function (a, b) { return (a.recebido - b.recebido) || String(b.data_compra).localeCompare(String(a.data_compra)); });
  var aberto = itens.filter(function (x) { return !x.recebido; }).reduce(function (s, x) { return s + U.centavos(x.terceiro_valor); }, 0);
  return { itens: itens, a_receber: U.reais(aberto) };
});
rota_('POST', '/api/compras/lote', {}, function (c) {
  var lista = R.validarLote(c.body, c.perfil), agora = D.agoraISO(); // valida tudo antes de gravar: ou entram todos, ou nenhum
  lista.forEach(function (v) { v.id = D.proximoId('CMP', 6); v.criado_por = c.perfil.email; v.criado_em = agora; });
  D.inserirVarios('compras', lista); // uma única escrita na planilha
  var total = lista.reduce(function (s, v) { return s + U.centavos(v.valor_total) / v.parcelas; }, 0);
  D.auditar(c.perfil.email, 'Lançou ' + lista.length + ' itens no cartão', 'compras', lista.map(function (v) { return v.id; }).join(','), { fatura: c.body.fatura, cartao: c.body.cartao_id });
  return { ok: true, n: lista.length, ids: lista.map(function (v) { return v.id; }), valor_na_fatura: U.reais(Math.round(total)) };
});
rota_('PUT', '/api/compras/(CMP-\\d+)', {}, function (c, id) {
  var at = D.porId('compras', id); if (!at) throw erro_(404, 'Compra não encontrada.');
  var car = D.porId('cartoes', at.cartao_id); exigirDono_(car && car.titular, c.perfil, 'Só o titular do cartão altera esta compra.');
  var v = R.validarCompra(c.body, at, c.perfil), novo = copia_(at); Object.keys(v).forEach(function (k) { novo[k] = v[k]; });
  novo.atualizado_por = c.perfil.email; novo.atualizado_em = D.agoraISO(); D.atualizar('compras', novo);
  D.auditar(c.perfil.email, 'Alterou compra no cartão', 'compras', id, v); return limpo_(novo);
});
rota_('DELETE', '/api/compras/(CMP-\\d+)', {}, function (c, id) {
  var at = D.porId('compras', id); if (!at) throw erro_(404, 'Compra não encontrada.');
  var car = D.porId('cartoes', at.cartao_id); exigirDono_(car && car.titular, c.perfil, 'Só o titular do cartão exclui esta compra.');
  D.excluir('compras', at); D.auditar(c.perfil.email, 'Excluiu compra no cartão', 'compras', id, limpo_(at)); return { ok: true };
});

// ---------- pix / débito ----------
rota_('GET', '/api/gastos', {}, function (c) {
  var mes = mesQuery_(c.query), pessoa = c.query.pessoa || '', tot = {}, ve = c.perfil.email;
  var itens = D.todos('gastos').filter(function (g) { return String(g.data).slice(0, 7) === mes && R.visivel(g.pago_por, g.divisao, ve); }).concat(R.gastosFixosDoMes(mes, ve)).map(function (g) {
    tot[g.pago_por] = tot[g.pago_por] || { total: 0, compartilhado: 0, receber: 0 }; var cc = U.centavos(g.valor), t = tot[g.pago_por];
    t.total += cc; if (g.divisao !== 'INDIVIDUAL') t.compartilhado += cc; t.receber += R.parteDoOutro(cc, g.divisao);
    var o = limpo_(g); o.pago_por_nome = P.nomeDe(g.pago_por); o.divisao_rotulo = R.rotuloDivisao(g.divisao, g.pago_por); o.parte_outro = U.reais(R.parteDoOutro(cc, g.divisao)); return o;
  }).filter(function (g) { return !pessoa || g.pago_por === pessoa; })
    .sort(function (a, b) { return String(b.data).localeCompare(String(a.data)) || String(b.criado_em).localeCompare(String(a.criado_em)); });
  return { mes: mes, rotulo: U.rotuloMes(mes), itens: itens, totais: P.ativos().map(function (u) { var t = tot[u.email] || { total: 0, compartilhado: 0, receber: 0 };
    return { email: u.email, nome: u.nome, total: u.email === ve ? U.reais(t.total) : null, compartilhado: U.reais(t.compartilhado), receber: U.reais(t.receber) }; }) };
});
rota_('POST', '/api/gastos', {}, function (c) {
  var v = R.validarGasto(c.body); v.id = D.proximoId('GAS', 6); v.pago_por = c.perfil.email; v.criado_por = c.perfil.email; v.criado_em = D.agoraISO();
  D.inserir('gastos', v); D.auditar(c.perfil.email, 'Lançou gasto pix/débito', 'gastos', v.id, { descricao: v.descricao, valor: v.valor, divisao: v.divisao }); return limpo_(v);
});
rota_('PUT', '/api/gastos/(GAS-\\d+)', {}, function (c, id) {
  var at = D.porId('gastos', id); if (!at) throw erro_(404, 'Gasto não encontrado.'); exigirDono_(at.pago_por, c.perfil, 'Só quem pagou altera este gasto.');
  var v = R.validarGasto(c.body), novo = copia_(at); Object.keys(v).forEach(function (k) { novo[k] = v[k]; });
  novo.atualizado_por = c.perfil.email; novo.atualizado_em = D.agoraISO(); D.atualizar('gastos', novo);
  D.auditar(c.perfil.email, 'Alterou gasto pix/débito', 'gastos', id, v); return limpo_(novo);
});
rota_('DELETE', '/api/gastos/(GAS-\\d+)', {}, function (c, id) {
  var at = D.porId('gastos', id); if (!at) throw erro_(404, 'Gasto não encontrado.'); exigirDono_(at.pago_por, c.perfil, 'Só quem pagou exclui este gasto.');
  D.excluir('gastos', at); D.auditar(c.perfil.email, 'Excluiu gasto pix/débito', 'gastos', id, limpo_(at)); return { ok: true };
});

// ---------- gastos fixos (recorrentes) ----------
function recInfo_(rc, mesRef) {
  var o = limpo_(rc), car = rc.cartao_id ? D.porId('cartoes', rc.cartao_id) : null;
  o.onde = rc.tipo === 'CARTAO' ? (car ? R.nomeCartao(car) : 'cartão removido') : ({ PIX: 'Pix', DEBITO: 'Débito', DINHEIRO: 'Dinheiro' }[rc.forma] || rc.forma);
  o.dono_nome = P.nomeDe(rc.dono); o.divisao_rotulo = R.rotuloDivisao(rc.divisao, rc.dono);
  o.situacao = R.recNoMes(rc, mesRef) ? 'ativo' : (rc.inicio > mesRef ? 'futuro' : 'encerrado');
  return o;
}
rota_('GET', '/api/recorrentes', {}, function (c) {
  var mes = mesQuery_(c.query), tot = {}, todos = D.todos('recorrentes');
  // trechos de um mesmo gasto (criados ao "alterar a partir de"): o anterior termina 1 mês antes do seguinte começar
  var chave = function (r) { return [r.dono, r.tipo, String(r.descricao).toLowerCase()].join('|'); }, porInicio = {};
  todos.forEach(function (r) { porInicio[chave(r) + '|' + r.inicio] = r; });
  var lista = todos.map(function (rc) {
    var o = recInfo_(rc, mes), ant = rc, prox = rc.fim ? porInicio[chave(rc) + '|' + U.somarMeses(rc.fim, 1)] : null;
    for (var k = 0; k < 120; k++) { var a = todos.filter(function (x) { return chave(x) === chave(ant) && x.fim && U.somarMeses(x.fim, 1) === ant.inicio; })[0]; if (!a) break; ant = a; }
    o.inicio_original = ant.inicio; if (prox) o.situacao = 'alterado';
    return o;
  });
  var ve = c.perfil.email; lista = lista.filter(function (o) { return R.visivel(o.dono, o.divisao, ve); });
  lista.forEach(function (o) { if (o.situacao !== 'ativo') return; var t = tot[o.dono] = tot[o.dono] || { total: 0, compartilhado: 0, receber: 0 }, cc = U.centavos(o.valor); t.total += cc; if (o.divisao !== 'INDIVIDUAL') t.compartilhado += cc; t.receber += R.parteDoOutro(cc, o.divisao); });
  lista.sort(function (a, b) { var ord = { ativo: 0, futuro: 1, encerrado: 2, alterado: 3 }; return ord[a.situacao] - ord[b.situacao] || a.descricao.localeCompare(b.descricao, 'pt-BR'); });
  return { mes: mes, rotulo: U.rotuloMes(mes), itens: lista, totais: P.ativos().map(function (u) { var t = tot[u.email] || { total: 0, compartilhado: 0, receber: 0 }; return { email: u.email, nome: u.nome, total: u.email === ve ? U.reais(t.total) : null, compartilhado: U.reais(t.compartilhado), receber: U.reais(t.receber) }; }) };
});
rota_('GET', '/api/recorrentes/(REC-\\d+)', {}, function (c, id) { var rc = D.porId('recorrentes', id); if (!rc) throw erro_(404, 'Gasto fixo não encontrado.'); exigirVisivel_(rc.dono, rc.divisao, c.perfil, 'Gasto fixo'); return recInfo_(rc, mesQuery_(c.query)); });
rota_('POST', '/api/recorrentes', {}, function (c) {
  var v = R.validarRecorrente(c.body, null, c.perfil); v.id = D.proximoId('REC', 4); v.criado_por = c.perfil.email; v.criado_em = D.agoraISO();
  D.inserir('recorrentes', v); D.auditar(c.perfil.email, 'Criou gasto fixo', 'recorrentes', v.id, { descricao: v.descricao, valor: v.valor, inicio: v.inicio }); return limpo_(v);
});
/**
 * Alterar gasto fixo. Com "a_partir_de" (AAAA-MM) depois do início, os meses anteriores ficam como estavam:
 * o registro atual termina no mês anterior e um novo começa em "a_partir_de" com os dados novos.
 */
rota_('PUT', '/api/recorrentes/(REC-\\d+)', {}, function (c, id) {
  var at = D.porId('recorrentes', id); if (!at) throw erro_(404, 'Gasto fixo não encontrado.'); exigirDono_(at.dono, c.perfil, 'Só quem cadastrou altera este gasto fixo.');
  var desde = String(c.body.a_partir_de || '').slice(0, 7), b = copia_(c.body); delete b.a_partir_de;
  if (U.mesValido(desde) && desde > at.inicio && (!at.fim || desde <= at.fim)) {
    b.inicio = desde; var novo = R.validarRecorrente(b, at, c.perfil); novo.id = D.proximoId('REC', 4); novo.criado_por = c.perfil.email; novo.criado_em = D.agoraISO();
    var velho = copia_(at); velho.fim = U.somarMeses(desde, -1); velho.atualizado_por = c.perfil.email; velho.atualizado_em = D.agoraISO();
    D.atualizar('recorrentes', velho); D.inserir('recorrentes', novo);
    D.auditar(c.perfil.email, 'Alterou gasto fixo a partir de ' + desde, 'recorrentes', id + '→' + novo.id, { valor: novo.valor, divisao: novo.divisao });
    return { ok: true, id: novo.id, dividiu: true };
  }
  var v = R.validarRecorrente(b, at, c.perfil), n = copia_(at); Object.keys(v).forEach(function (k) { n[k] = v[k]; });
  n.atualizado_por = c.perfil.email; n.atualizado_em = D.agoraISO(); D.atualizar('recorrentes', n);
  D.auditar(c.perfil.email, 'Alterou gasto fixo', 'recorrentes', id, v); return { ok: true, id: id };
});
rota_('PUT', '/api/recorrentes/(REC-\\d+)/encerrar', {}, function (c, id) {
  var at = D.porId('recorrentes', id); if (!at) throw erro_(404, 'Gasto fixo não encontrado.'); exigirDono_(at.dono, c.perfil, 'Só quem cadastrou encerra este gasto fixo.');
  var ult = String(c.body.ultimo_mes || '').slice(0, 7); if (!U.mesValido(ult)) throw erro_(400, 'Informe o último mês do gasto fixo.');
  if (ult < at.inicio) throw erro_(400, 'O último mês não pode ser antes do início (' + U.rotuloMes(at.inicio) + '). Se nunca aconteceu, exclua o gasto fixo.');
  var n = copia_(at); n.fim = ult; n.atualizado_por = c.perfil.email; n.atualizado_em = D.agoraISO(); D.atualizar('recorrentes', n);
  D.auditar(c.perfil.email, 'Encerrou gasto fixo', 'recorrentes', id, { ultimo_mes: ult }); return { ok: true };
});
rota_('DELETE', '/api/recorrentes/(REC-\\d+)', {}, function (c, id) {
  var at = D.porId('recorrentes', id); if (!at) throw erro_(404, 'Gasto fixo não encontrado.'); exigirDono_(at.dono, c.perfil, 'Só quem cadastrou exclui este gasto fixo.');
  D.excluir('recorrentes', at); D.auditar(c.perfil.email, 'Excluiu gasto fixo', 'recorrentes', id, limpo_(at)); return { ok: true };
});

// ---------- metas (planejamento) ----------
rota_('GET', '/api/metas', {}, function (c) { return M.listar(mesQuery_(c.query)); });
rota_('GET', '/api/metas/(MET-\\d+)', {}, function (c, id) {
  var m = D.porId('metas', id); if (!m) throw erro_(404, 'Meta não encontrada.');
  var o = M.situacao(m, mesQuery_(c.query));
  o.aportes = M.aportesDe(id).map(function (a) { var x = limpo_(a); x.quem_nome = P.nomeDe(a.quem); return x; }).sort(function (a, b) { return String(b.data).localeCompare(String(a.data)) || String(b.criado_em).localeCompare(String(a.criado_em)); });
  return o;
});
rota_('POST', '/api/metas', {}, function (c) {
  var v = M.validar(c.body, null); v.id = D.proximoId('MET', 3); v.ativa = 1; v.criado_por = c.perfil.email; v.criado_em = D.agoraISO();
  D.inserir('metas', v); D.auditar(c.perfil.email, 'Criou meta', 'metas', v.id, { nome: v.nome, valor_alvo: v.valor_alvo, mes_alvo: v.mes_alvo }); return M.situacao(v);
});
rota_('PUT', '/api/metas/(MET-\\d+)', {}, function (c, id) {
  var at = D.porId('metas', id); if (!at) throw erro_(404, 'Meta não encontrada.');
  var n = copia_(at);
  if (c.body.acao === 'concluir') { n.ativa = 0; n.concluida_em = D.hojeISO(); }
  else if (c.body.acao === 'reabrir') { n.ativa = 1; n.concluida_em = ''; }
  else { var v = M.validar(c.body, at); Object.keys(v).forEach(function (k) { n[k] = v[k]; }); }
  n.atualizado_por = c.perfil.email; n.atualizado_em = D.agoraISO(); D.atualizar('metas', n);
  D.auditar(c.perfil.email, c.body.acao === 'concluir' ? 'Concluiu meta' : c.body.acao === 'reabrir' ? 'Reabriu meta' : 'Alterou meta', 'metas', id, null); return M.situacao(n);
});
rota_('DELETE', '/api/metas/(MET-\\d+)', {}, function (c, id) {
  var at = D.porId('metas', id); if (!at) throw erro_(404, 'Meta não encontrada.');
  var aps = M.aportesDe(id); aps.slice().sort(function (a, b) { return (b._r || 0) - (a._r || 0); }).forEach(function (a) { D.excluir('aportes', a); });
  D.excluir('metas', at); D.auditar(c.perfil.email, 'Excluiu meta', 'metas', id, { nome: at.nome, depositos: aps.length }); return { ok: true };
});
rota_('POST', '/api/metas/(MET-\\d+)/aportes', {}, function (c, id) {
  var m = D.porId('metas', id); if (!m) throw erro_(404, 'Meta não encontrada.');
  var cc = U.centavos(c.body.valor); if (isNaN(cc) || cc === 0 || Math.abs(cc) > 1e11) throw erro_(400, 'Informe o valor guardado (para retirada, use valor negativo).');
  var data = String(c.body.data || D.hojeISO()); if (!U.dataValida(data)) throw erro_(400, 'Data inválida.');
  var quem = c.body.quem || c.perfil.email; if (!P.ativos().some(function (u) { return u.email === quem; })) throw erro_(400, 'Pessoa inválida.');
  var v = { id: D.proximoId('APO', 6), meta_id: id, data: data, valor: U.reais(cc), quem: quem, obs: U.texto(c.body.obs, 200), criado_por: c.perfil.email, criado_em: D.agoraISO() };
  D.inserir('aportes', v); D.auditar(c.perfil.email, cc > 0 ? 'Guardou na meta' : 'Retirou da meta', 'metas', id, { valor: v.valor, quem: quem }); return M.situacao(m);
});
rota_('DELETE', '/api/aportes/(APO-\\d+)', {}, function (c, id) {
  var a = D.porId('aportes', id); if (!a) throw erro_(404, 'Depósito não encontrado.');
  if (a.criado_por !== c.perfil.email && a.quem !== c.perfil.email) throw erro_(403, 'Só quem registrou exclui este depósito.');
  D.excluir('aportes', a); D.auditar(c.perfil.email, 'Excluiu depósito da meta', 'metas', a.meta_id, limpo_(a)); return { ok: true };
});

// ---------- ganhos e painel do início ----------
rota_('GET', '/api/painel', {}, function (c) { return PN.painel(mesQuery_(c.query), c.perfil.email); });
rota_('GET', '/api/rendas', {}, function (c) { return PN.listar(mesQuery_(c.query)); });
rota_('POST', '/api/rendas', {}, function (c) {
  var v = PN.validar(c.body, null, c.perfil); v.id = D.proximoId('GAN', 4); v.criado_por = c.perfil.email; v.criado_em = D.agoraISO();
  D.inserir('rendas', v); D.auditar(c.perfil.email, 'Cadastrou ganho', 'rendas', v.id, { descricao: v.descricao, valor: v.valor, tipo: v.tipo }); return limpo_(v);
});
/** Alterar ganho. Com "a_partir_de" depois do início (ex.: aumento de salário), os meses anteriores não mudam. */
rota_('PUT', '/api/rendas/(GAN-\\d+)', {}, function (c, id) {
  var at = D.porId('rendas', id); if (!at) throw erro_(404, 'Ganho não encontrado.'); exigirDono_(at.pessoa, c.perfil, 'Cada um altera os próprios ganhos.');
  var desde = String(c.body.a_partir_de || '').slice(0, 7), b = copia_(c.body); delete b.a_partir_de;
  if (at.tipo === 'FIXA' && U.mesValido(desde) && desde > at.inicio && (!at.fim || desde <= at.fim)) {
    b.inicio = desde; var novo = PN.validar(b, at, c.perfil); novo.id = D.proximoId('GAN', 4); novo.criado_por = c.perfil.email; novo.criado_em = D.agoraISO();
    var velho = copia_(at); velho.fim = U.somarMeses(desde, -1); velho.atualizado_por = c.perfil.email; velho.atualizado_em = D.agoraISO();
    D.atualizar('rendas', velho); D.inserir('rendas', novo); D.auditar(c.perfil.email, 'Alterou ganho a partir de ' + desde, 'rendas', id + '→' + novo.id, { valor: novo.valor }); return { ok: true, id: novo.id };
  }
  var v = PN.validar(b, at, c.perfil), n = copia_(at); Object.keys(v).forEach(function (k) { n[k] = v[k]; });
  n.atualizado_por = c.perfil.email; n.atualizado_em = D.agoraISO(); D.atualizar('rendas', n); D.auditar(c.perfil.email, 'Alterou ganho', 'rendas', id, v); return { ok: true, id: id };
});
rota_('PUT', '/api/rendas/(GAN-\\d+)/encerrar', {}, function (c, id) {
  var at = D.porId('rendas', id); if (!at) throw erro_(404, 'Ganho não encontrado.'); exigirDono_(at.pessoa, c.perfil, 'Cada um altera os próprios ganhos.');
  var ult = String(c.body.ultimo_mes || '').slice(0, 7); if (!U.mesValido(ult) || ult < at.inicio) throw erro_(400, 'Último mês inválido.');
  var n = copia_(at); n.fim = ult; n.atualizado_por = c.perfil.email; n.atualizado_em = D.agoraISO(); D.atualizar('rendas', n); D.auditar(c.perfil.email, 'Encerrou ganho', 'rendas', id, { ultimo_mes: ult }); return { ok: true };
});
rota_('DELETE', '/api/rendas/(GAN-\\d+)', {}, function (c, id) {
  var at = D.porId('rendas', id); if (!at) throw erro_(404, 'Ganho não encontrado.'); exigirDono_(at.pessoa, c.perfil, 'Cada um altera os próprios ganhos.');
  D.excluir('rendas', at); D.auditar(c.perfil.email, 'Excluiu ganho', 'rendas', id, limpo_(at)); return { ok: true };
});

// ---------- acerto do mês ----------
rota_('GET', '/api/acerto', {}, function (c) { return acertoPara_(R.acerto(mesQuery_(c.query)), c.perfil.email); });
rota_('GET', '/api/acerto/historico', {}, function () { return R.historicoAcertos(); });
rota_('POST', '/api/acertos', {}, function (c) {
  var par = P.parceiroDe(c.perfil.email); if (!par) throw erro_(400, 'Ainda não há outra pessoa cadastrada.');
  var mes = String(c.body.mes || ''); if (!U.mesValido(mes)) throw erro_(400, 'Mês inválido.');
  var cc = U.centavos(c.body.valor); if (isNaN(cc) || cc <= 0) throw erro_(400, 'Informe o valor do acerto.');
  var data = String(c.body.data || D.hojeISO()); if (!U.dataValida(data)) throw erro_(400, 'Data inválida.');
  var paguei = c.body.direcao !== 'RECEBI';
  var v = { id: D.proximoId('ACE', 5), mes: mes, de: paguei ? c.perfil.email : par.email, para: paguei ? par.email : c.perfil.email, valor: U.reais(cc), data: data, obs: U.texto(c.body.obs, 200), criado_por: c.perfil.email, criado_em: D.agoraISO() };
  D.inserir('acertos', v); D.auditar(c.perfil.email, 'Registrou acerto', 'acertos', v.id, { mes: mes, de: v.de, para: v.para, valor: v.valor }); return limpo_(v);
});
rota_('DELETE', '/api/acertos/(ACE-\\d+)', {}, function (c, id) {
  var at = D.porId('acertos', id); if (!at) throw erro_(404, 'Acerto não encontrado.');
  if (at.de !== c.perfil.email && at.para !== c.perfil.email) throw erro_(403, 'Sem permissão.');
  D.excluir('acertos', at); D.auditar(c.perfil.email, 'Excluiu acerto', 'acertos', id, limpo_(at)); return { ok: true };
});

// ---------- histórico de alterações ----------
rota_('GET', '/api/historico', {}, function (c) {
  var lim = Math.min(Number(c.query.limite) || 200, 1000), t = c.query.q ? String(c.query.q).toLowerCase() : '', nomes = {};
  D.todos('usuarios').forEach(function (u) { nomes[u.email] = u.nome; });
  var ve = c.perfil.email, l = D.ultimasAuditorias(Math.min(lim * 3, 3000)).reverse().filter(function (a) { return podeVerAuditoria_(a, ve); });
  if (t) l = l.filter(function (a) { return [a.usuario, a.acao, a.entidade_id, a.detalhe].some(function (x) { return x != null && String(x).toLowerCase().indexOf(t) >= 0; }); });
  return l.slice(0, lim).map(function (a) { a.usuario_nome = nomes[a.usuario] || a.usuario; return a; });
});

/** Do outro, o histórico mostra só ações em lançamentos divididos (e em metas, ganhos e acertos, que são do casal). */
function podeVerAuditoria_(a, ve) {
  if (!a.usuario || a.usuario === ve || a.usuario === 'sistema') return true;
  var ent = a.entidade, tab = { compras: 'compras', gastos: 'gastos', recorrentes: 'recorrentes' }[ent];
  if (!tab) return ['metas', 'rendas', 'acertos', 'usuarios'].indexOf(ent) >= 0;
  var ids = String(a.entidade_id || '').split(/[,→]/).filter(Boolean); if (!ids.length) return false;
  var det = null; try { det = a.detalhe ? JSON.parse(a.detalhe) : null; } catch (e) { det = null; }
  return ids.every(function (id) {
    var r = D.porId(tab, id.trim()); if (r) return r.divisao && r.divisao !== 'INDIVIDUAL';
    return !!(det && det.divisao && det.divisao !== 'INDIVIDUAL'); // excluído: vale a divisão registrada na exclusão
  });
}

// ---------- exportação (CSV) ----------
rota_('GET', '/api/exportar\\.csv', { escreve: true }, function (c) {
  var ve = c.perfil.email, mes = mesQuery_(c.query), ac = R.acerto(mes), idx = R.indice(), linhas = [['Origem', 'Data', 'Descrição', 'Categoria', 'Cartão / forma', 'Parcela', 'Pago por', 'Divisão', 'Valor (R$)', 'Parte do outro (R$)', 'Sua parte (R$)', 'Terceiro paga']];
  var fmt = function (v) { return String(v).replace('.', ','); };
  (idx[mes] || []).filter(function (it) { return R.visivel(it.pagador, it.divisao, ve); }).sort(function (a, b) { return String(a.data).localeCompare(String(b.data)); }).forEach(function (it) {
    linhas.push([it.origem === 'CARTAO' ? 'Cartão' : 'Pix/débito', it.data, it.descricao, it.categoria, it.cartao || it.forma, it.parcela || '', P.nomeDe(it.pagador), R.rotuloDivisao(it.divisao, it.pagador), fmt(U.reais(it.c)), fmt(U.reais(R.parteDoOutro(R.efetivo(it), it.divisao))), fmt(U.reais(R.minhaParte(it, ve))), it.t ? it.terceiro + ' paga ' + fmt(U.reais(it.t)) : '']);
  });
  linhas.push([]); linhas.push(['Resultado', ac.devedor ? ac.devedor.nome + ' deve a ' + ac.credor.nome : 'Sem saldo', '', '', '', '', '', '', fmt(ac.devido), '', '', '']);
  var csv = '﻿' + linhas.map(function (l) { return l.map(function (x) { x = String(x == null ? '' : x); return /[";\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }).join(';'); }).join('\r\n');
  D.auditar(c.perfil.email, 'Exportou o mês', 'exportar', mes, null);
  return { __arquivo: true, tipo: 'text/csv; charset=utf-8', nome: 'contas_' + mes + '.csv', b64: Utilities.base64Encode(csv, Utilities.Charset.UTF_8) };
});

// ---------- limites por categoria (cada um define os seus) ----------
rota_('GET', '/api/limites', {}, function (c) { var mes = mesQuery_(c.query); return { mes: mes, rotulo: U.rotuloMes(mes), itens: PN.situacaoLimites(R.indice(), mes, c.perfil.email), categorias: R.categorias() }; });
rota_('POST', '/api/limites', {}, function (c) {
  var v = PN.validarLimite(c.body, null, c.perfil); v.id = D.proximoId('LIM', 3); v.criado_em = D.agoraISO(); D.inserir('limites', v);
  D.auditar(c.perfil.email, 'Definiu limite', 'limites', v.id, { categoria: v.categoria, valor: v.valor }); return limpo_(v);
});
rota_('PUT', '/api/limites/(LIM-\\d+)', {}, function (c, id) {
  var at = D.porId('limites', id); if (!at) throw erro_(404, 'Limite não encontrado.'); exigirDono_(at.dono, c.perfil, 'Cada um altera os próprios limites.');
  var v = PN.validarLimite(c.body, at, c.perfil), n = copia_(at); Object.keys(v).forEach(function (k) { n[k] = v[k]; }); n.atualizado_em = D.agoraISO();
  D.atualizar('limites', n); D.auditar(c.perfil.email, 'Alterou limite', 'limites', id, { categoria: n.categoria, valor: n.valor }); return limpo_(n);
});
rota_('DELETE', '/api/limites/(LIM-\\d+)', {}, function (c, id) {
  var at = D.porId('limites', id); if (!at) throw erro_(404, 'Limite não encontrado.'); exigirDono_(at.dono, c.perfil, 'Cada um altera os próprios limites.');
  D.excluir('limites', at); D.auditar(c.perfil.email, 'Excluiu limite', 'limites', id, { categoria: at.categoria }); return { ok: true };
});

// ---------- evolução e reserva de emergência ----------
rota_('GET', '/api/evolucao', {}, function (c) { return { meses: PN.evolucao(mesQuery_(c.query), c.perfil.email) }; });
rota_('GET', '/api/metas/reserva', {}, function (c) { return PN.reservaSugerida(mesQuery_(c.query)); });

// ---------- avisos por e-mail ----------
rota_('GET', '/api/avisos', {}, function (c) { return { prefs: AV.prefs(c.perfil.email), agendado: AV.acionadorAtivo(), email: c.perfil.email }; });
rota_('PUT', '/api/avisos', {}, function (c) { var p = AV.salvarPrefs(c.perfil.email, c.body || {}); D.auditar(c.perfil.email, 'Alterou avisos por e-mail', 'config', 'avisos:' + c.perfil.email, p); return { prefs: p, agendado: AV.acionadorAtivo() }; });
rota_('POST', '/api/avisos/teste', {}, function (c) { A.limitarFrequencia('teste_email', c.perfil.email, 3, 3600, 'Você já pediu 3 e-mails de teste nesta hora. Tente mais tarde.'); return AV.teste(c.perfil); });

// ---------- importar extrato (OFX / CSV) ----------
rota_('POST', '/api/extrato/ler', {}, function (c) { return EXT.analisar(c.body.texto, c.body.nome, c.perfil); });
rota_('POST', '/api/gastos/lote', {}, function (c) { return EXT.lancar(c.body, c.perfil); });
