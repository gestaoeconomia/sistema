/**
 * V1.5 — mais simples no dia a dia e mais controle:
 *  • BUSCA: encontra lançamentos (cartão, pix/débito, gastos fixos) em todos os meses, com totais.
 *  • CATS: categoria sugerida pela descrição (aprende com o histórico) e renomear/juntar categorias.
 *  • DESF: "Desfazer" uma exclusão por 15 minutos.
 *  • FECH: fechar o mês (o que entra no acerto e nos números do mês não muda mais até reabrir).
 *  • PREV: previsão de fim do mês e teto geral de gastos do mês (orçamento).
 *  • VENC: calendário de vencimentos e "marcar como pago" dos gastos fixos de pix/débito/boleto.
 *  • ASSIN: compras que se repetem todo mês (parecem assinatura) e aumentos de valor.
 *
 * PRIVACIDADE (a mesma do resto do app): cada um vê tudo o que é seu; do outro, só o que é dividido ou "todo do outro".
 */
function chaveDesc_(s) {
  var PARAR = { parc: 1, parcela: 1, de: 1, da: 1, do: 1, das: 1, dos: 1, em: 1, e: 1, com: 1, pg: 1, pag: 1, pagto: 1, pagamento: 1, compra: 1, pix: 1, transferencia: 1, transf: 1, enviado: 1, enviada: 1, recebido: 1,
    debito: 1, credito: 1, cartao: 1, ltda: 1, sa: 1, me: 1, eireli: 1, br: 1, www: 1, online: 1, loja: 1, no: 1, na: 1, para: 1, ao: 1, a: 1, o: 1 };
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter(function (t) { return t.length >= 2 && !PARAR[t] && !/^\d+$/.test(t) && !/^\d+x$/.test(t); });
}
function normCat_(c) { return String(c || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

// ================================================================ FECHAMENTO DO MÊS
var FECH = (function () {
  var PREF = 'fechado|';
  function info(mes) {
    var v = D.config(PREF + mes, ''); if (!v) return null;
    try { var o = JSON.parse(v); return o && o.por ? { mes: mes, por: o.por, por_nome: P.nomeDe(o.por), em: o.em, restante: o.restante || 0 } : null; } catch (e) { return null; }
  }
  function fechados() {
    var out = []; D.todos('config').forEach(function (c) { var k = String(c.chave || ''); if (k.indexOf(PREF) === 0 && c.valor && U.mesValido(k.slice(PREF.length)) && info(k.slice(PREF.length))) out.push(k.slice(PREF.length)); });
    return out.filter(function (m, i) { return out.indexOf(m) === i; }).sort();
  }
  function msg(bate, oQue) {
    return (oQue || 'Esta alteração') + ' mexe em ' + (bate.length === 1 ? 'um mês fechado (' : 'meses fechados (') + bate.map(U.rotuloMes).join(', ') + '). Para alterar, reabra o mês na tela "Acerto do mês".';
  }
  /** Recusa se algum dos meses estiver fechado. */
  function exigirAbertos(meses, oQue) {
    var f = fechados(); if (!f.length) return;
    var bate = f.filter(function (m) { return meses.indexOf(m) >= 0; }); if (bate.length) throw erro_(409, msg(bate, oQue));
  }
  /** Recusa se algum mês fechado estiver na faixa [ini, fim] (fim vazio = sem fim). */
  function exigirFaixa(ini, fim, oQue) {
    var f = fechados(); if (!f.length || !U.mesValido(ini)) return;
    var bate = f.filter(function (m) { return m >= ini && (!U.mesValido(fim) || m <= fim); }); if (bate.length) throw erro_(409, msg(bate, oQue));
  }
  function mesesCompra(cp) { try { return R.parcelas(cp).map(function (p) { return p.mes; }); } catch (e) { return [String(cp.primeira_fatura || '').slice(0, 7)]; } }
  function fechar(mes, perfil) {
    if (!U.mesValido(mes)) throw erro_(400, 'Mês inválido.');
    if (mes > U.mesAtual()) throw erro_(400, 'Só dá para fechar um mês que já começou.');
    if (info(mes)) throw erro_(409, 'Este mês já está fechado.');
    var ac = R.acerto(mes);
    D.definirConfig(PREF + mes, JSON.stringify({ por: perfil.email, em: D.agoraISO(), restante: ac.restante_abs || 0 }));
    D.auditar(perfil.email, 'Fechou o mês', 'acertos', mes, { restante: ac.restante_abs || 0 });
    NT.avisar(perfil.email, 'fechamento', P.primeiroNome(perfil.nome) + ' fechou ' + U.rotuloMes(mes), 'Os lançamentos que entram no acerto desse mês ficam travados até alguém reabrir.', 'acerto', { mes: mes }, mes);
    return info(mes);
  }
  function reabrir(mes, perfil) {
    if (!info(mes)) throw erro_(409, 'Este mês não está fechado.');
    D.definirConfig(PREF + mes, '');
    D.auditar(perfil.email, 'Reabriu o mês', 'acertos', mes, null);
    NT.avisar(perfil.email, 'fechamento', P.primeiroNome(perfil.nome) + ' reabriu ' + U.rotuloMes(mes), 'Os lançamentos desse mês voltaram a poder ser alterados.', 'acerto', { mes: mes }, mes);
    return { ok: true };
  }
  return { info: info, fechados: fechados, exigirAbertos: exigirAbertos, exigirFaixa: exigirFaixa, mesesCompra: mesesCompra, fechar: fechar, reabrir: reabrir };
})();

// ================================================================ DESFAZER EXCLUSÃO (15 min)
var DESF = (function () {
  var TABS = { compras: 'compra', gastos: 'gasto', recorrentes: 'gasto fixo', rendas: 'ganho', acertos: 'acerto', limites: 'limite', aportes: 'depósito' }, PRAZO = 900;
  var VOLTOU = { compras: 'Compra restaurada.', gastos: 'Gasto restaurado.', recorrentes: 'Gasto fixo restaurado.', rendas: 'Ganho restaurado.', acertos: 'Acerto restaurado.', limites: 'Limite restaurado.', aportes: 'Depósito restaurado.' };
  function guardar(tab, reg, perfil) {
    if (!TABS[tab]) return null;
    var tk = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8), o = {};
    Object.keys(reg).forEach(function (k) { if (k !== '_r') o[k] = reg[k]; });
    try { CacheService.getScriptCache().put('desf_' + tk, JSON.stringify({ tab: tab, reg: o, quem: perfil.email }), PRAZO); } catch (e) { return null; }
    return tk;
  }
  function conferirMeses(tab, r) {
    var oq = 'Desfazer a exclusão';
    if (tab === 'compras') FECH.exigirAbertos(FECH.mesesCompra(r), oq);
    else if (tab === 'gastos') FECH.exigirAbertos([String(r.data).slice(0, 7)], oq);
    else if (tab === 'recorrentes' || tab === 'rendas') FECH.exigirFaixa(String(r.inicio).slice(0, 7), String(r.fim || '').slice(0, 7), oq);
    else if (tab === 'acertos') FECH.exigirAbertos([String(r.mes).slice(0, 7)], oq);
  }
  function desfazer(tk, perfil) {
    tk = String(tk || ''); if (!/^[a-f0-9]{40}$/.test(tk)) throw erro_(400, 'Pedido inválido.');
    var c = CacheService.getScriptCache(), d = null; try { d = JSON.parse(c.get('desf_' + tk) || 'null'); } catch (e) { d = null; }
    if (!d || !TABS[d.tab]) throw erro_(410, 'O prazo para desfazer acabou (15 minutos).');
    if (d.quem !== perfil.email) throw erro_(403, 'Só quem excluiu pode desfazer.');
    var r = d.reg, idc = D.ESQ[d.tab].nomes[0];
    if (D.porId(d.tab, r[idc])) { c.remove('desf_' + tk); throw erro_(409, 'Este registro já foi restaurado.'); }
    if (d.tab === 'compras' && !D.porId('cartoes', r.cartao_id)) throw erro_(409, 'O cartão desta compra foi excluído.');
    if (d.tab === 'aportes' && !D.porId('metas', r.meta_id)) throw erro_(409, 'A meta deste depósito foi excluída.');
    if (d.tab === 'limites' && D.todos('limites').some(function (l) { return l.dono === r.dono && normCat_(l.categoria) === normCat_(r.categoria); })) throw erro_(409, 'Você já criou outro limite para esta categoria.');
    conferirMeses(d.tab, r);
    D.inserir(d.tab, r); c.remove('desf_' + tk);
    if (d.tab === 'compras') NT.compra(perfil, 'novo', r, null); else if (d.tab === 'gastos') NT.gasto(perfil, 'novo', r, null);
    D.auditar(perfil.email, 'Desfez a exclusão (' + TABS[d.tab] + ')', d.tab, r[idc], null);
    return { ok: true, tabela: d.tab, id: r[idc], oque: TABS[d.tab], mensagem: VOLTOU[d.tab] };
  }
  return { guardar: guardar, desfazer: desfazer };
})();

// ================================================================ CATEGORIAS: sugestão e organização
var CATS = (function () {
  // primeiras sugestões, antes de haver histórico (palavra da descrição → categoria padrão)
  var SEMENTES = { ifood: 'Restaurante / delivery', rappi: 'Restaurante / delivery', restaurante: 'Restaurante / delivery', lanchonete: 'Restaurante / delivery', pizzaria: 'Restaurante / delivery', padaria: 'Mercado', mcdonalds: 'Restaurante / delivery', burger: 'Restaurante / delivery',
    mercado: 'Mercado', supermercado: 'Mercado', atacadao: 'Mercado', assai: 'Mercado', carrefour: 'Mercado', extra: 'Mercado', feira: 'Mercado', hortifruti: 'Mercado', acougue: 'Mercado',
    uber: 'Transporte', '99app': 'Transporte', '99pop': 'Transporte', posto: 'Transporte', combustivel: 'Transporte', gasolina: 'Transporte', shell: 'Transporte', ipiranga: 'Transporte', estacionamento: 'Transporte', pedagio: 'Transporte', metro: 'Transporte',
    farmacia: 'Saúde', drogaria: 'Saúde', raia: 'Saúde', drogasil: 'Saúde', pague: 'Saúde', clinica: 'Saúde', laboratorio: 'Saúde', hospital: 'Saúde', dentista: 'Saúde', unimed: 'Saúde', hapvida: 'Saúde',
    netflix: 'Assinaturas', spotify: 'Assinaturas', disney: 'Assinaturas', hbo: 'Assinaturas', max: 'Assinaturas', prime: 'Assinaturas', youtube: 'Assinaturas', deezer: 'Assinaturas', globoplay: 'Assinaturas', icloud: 'Assinaturas', apple: 'Assinaturas', google: 'Assinaturas',
    petz: 'Pets', cobasi: 'Pets', petshop: 'Pets', veterinario: 'Pets', racao: 'Pets',
    aluguel: 'Casa', condominio: 'Casa', luz: 'Contas fixas', energia: 'Contas fixas', neoenergia: 'Contas fixas', celpe: 'Contas fixas', agua: 'Contas fixas', compesa: 'Contas fixas', internet: 'Contas fixas', claro: 'Contas fixas', vivo: 'Contas fixas', tim: 'Contas fixas', oi: 'Contas fixas',
    escola: 'Educação', faculdade: 'Educação', curso: 'Educação', livraria: 'Educação', renner: 'Vestuário', riachuelo: 'Vestuário', cea: 'Vestuário', zara: 'Vestuário', shein: 'Vestuário', centauro: 'Vestuário', netshoes: 'Vestuário',
    cinema: 'Lazer', cinemark: 'Lazer', ingresso: 'Lazer', bar: 'Lazer', steam: 'Lazer', playstation: 'Lazer', hotel: 'Viagem', airbnb: 'Viagem', booking: 'Viagem', latam: 'Viagem', gol: 'Viagem', azul: 'Viagem', decolar: 'Viagem' };
  /** Lançamentos que quem está vendo pode ver (os do outro só se divididos). */
  function visiveis(ve) {
    var cart = D.mapa('cartoes'), out = [];
    D.todos('compras').forEach(function (x) { var car = cart[x.cartao_id]; if (car && R.visivel(car.titular, x.divisao, ve)) out.push({ d: x.descricao, c: x.categoria, t: x.criado_em || x.data_compra }); });
    D.todos('gastos').forEach(function (x) { if (R.visivel(x.pago_por, x.divisao, ve)) out.push({ d: x.descricao, c: x.categoria, t: x.criado_em || x.data }); });
    D.todos('recorrentes').forEach(function (x) { if (R.visivel(x.dono, x.divisao, ve)) out.push({ d: x.descricao, c: x.categoria, t: x.criado_em || x.inicio }); });
    return out;
  }
  /** Mapas para o navegador sugerir a categoria enquanto a descrição é digitada: f = descrição inteira, p = 1ª palavra. */
  function sugestoes(ve) {
    var cont = { f: {}, p: {} };
    var somar = function (mapa, k, cat, t) { if (!k) return; var m = mapa[k] = mapa[k] || {}; var x = m[cat] = m[cat] || { n: 0, t: '' }; x.n++; if (String(t) > x.t) x.t = String(t); };
    visiveis(ve).forEach(function (x) {
      var cat = U.texto(x.c, 40); if (!cat) return; var tk = chaveDesc_(x.d); if (!tk.length) return;
      somar(cont.f, tk.slice(0, 3).join(' '), cat, x.t); somar(cont.p, tk[0], cat, x.t);
    });
    var melhor = function (m) { var b = null; Object.keys(m).forEach(function (c) { if (!b || m[c].n > m[b].n || (m[c].n === m[b].n && m[c].t > m[b].t)) b = c; }); return b; };
    var out = { f: {}, p: {} }, n = 0;
    Object.keys(cont.f).forEach(function (k) { if (n++ < 3000) out.f[k] = melhor(cont.f[k]); });
    n = 0; Object.keys(cont.p).forEach(function (k) { if (n++ < 2000) out.p[k] = melhor(cont.p[k]); });
    Object.keys(SEMENTES).forEach(function (k) { if (!out.p[k]) out.p[k] = SEMENTES[k]; });
    return out;
  }
  /** Categorias em uso, com quantos lançamentos usam cada uma (todos os lançamentos do casal: a categoria é um nome comum aos dois). */
  function lista(ve) {
    var m = {};
    var add = function (nome, campo) { nome = U.texto(nome, 40); if (!nome) return; var k = normCat_(nome), x = m[k] = m[k] || { nome: nome, nomes: {}, compras: 0, gastos: 0, fixos: 0, limites: 0, total: 0 }; x.nomes[nome] = (x.nomes[nome] || 0) + 1; if (campo) { x[campo]++; x.total++; } };
    R.categorias().forEach(function (c) { add(c, null); });
    D.todos('compras').forEach(function (x) { add(x.categoria, 'compras'); });
    D.todos('gastos').forEach(function (x) { add(x.categoria, 'gastos'); });
    D.todos('recorrentes').forEach(function (x) { add(x.categoria, 'fixos'); });
    D.todos('limites').forEach(function (x) { if (x.dono === ve) add(x.categoria, 'limites'); });
    var semCat = D.todos('compras').filter(function (x) { return !x.categoria; }).length + D.todos('gastos').filter(function (x) { return !x.categoria; }).length;
    var itens = Object.keys(m).map(function (k) {
      var x = m[k], grafias = Object.keys(x.nomes).sort(function (a, b) { return x.nomes[b] - x.nomes[a]; });
      // nomes parecidos (mesma palavra principal): candidatos a juntar
      return { nome: grafias[0], grafias: grafias, compras: x.compras, gastos: x.gastos, fixos: x.fixos, limites: x.limites, total: x.total, padrao: CATEGORIAS_PADRAO_().indexOf(grafias[0]) >= 0 };
    }).sort(function (a, b) { return b.total - a.total || ORD_PT_(a.nome, b.nome); });
    var parecidas = [];
    for (var i = 0; i < itens.length; i++) for (var j = i + 1; j < itens.length; j++) {
      var a = chaveDesc_(itens[i].nome)[0], b = chaveDesc_(itens[j].nome)[0];
      if (a && b && (a === b || (a.length >= 5 && b.indexOf(a) >= 0) || (b.length >= 5 && a.indexOf(b) >= 0))) parecidas.push([itens[i].nome, itens[j].nome]);
    }
    return { itens: itens, sem_categoria: semCat, parecidas: parecidas.slice(0, 20) };
  }
  /** Renomeia (ou junta) uma categoria em todos os lançamentos, gastos fixos e limites. */
  function renomear(de, para, perfil) {
    de = U.texto(de, 40); para = U.texto(para, 40);
    if (de.length < 1) throw erro_(400, 'Escolha a categoria a renomear.');
    if (para.length < 2) throw erro_(400, 'Informe o novo nome (ao menos 2 letras).');
    var kd = normCat_(de), kp = normCat_(para), agora = D.agoraISO(), n = { compras: 0, gastos: 0, recorrentes: 0, limites: 0 };
    ['compras', 'gastos', 'recorrentes'].forEach(function (t) {
      var alt = D.todos(t).filter(function (x) { return normCat_(x.categoria) === kd && x.categoria !== para; }).map(function (x) { var o = copia_(x); o.categoria = para; o.atualizado_em = agora; o.atualizado_por = perfil.email; return o; });
      if (alt.length) { D.atualizarVarios(t, alt); n[t] = alt.length; }
    });
    // limites: de cada pessoa; se já houver limite com o nome novo, fica o dele e o da categoria antiga sai
    var lims = D.todos('limites'), sai = [], muda = [];
    lims.filter(function (l) { return normCat_(l.categoria) === kd && l.categoria !== para; }).forEach(function (l) {
      var ja = kd !== kp && lims.some(function (o) { return o.dono === l.dono && o.id !== l.id && normCat_(o.categoria) === kp; });
      if (ja) sai.push(l); else { var o = copia_(l); o.categoria = para; o.atualizado_em = agora; muda.push(o); }
    });
    if (muda.length) D.atualizarVarios('limites', muda); if (sai.length) D.excluirVarios('limites', sai); n.limites = muda.length + sai.length;
    var tot = n.compras + n.gastos + n.recorrentes + n.limites;
    if (!tot) throw erro_(404, kd === kp ? 'Nada para mudar: todos já usam "' + para + '".' : 'Nenhum lançamento usa a categoria "' + de + '".');
    D.auditar(perfil.email, kd === kp ? 'Corrigiu o nome da categoria' : 'Juntou/renomeou categoria', 'config', 'categoria', { de: de, para: para, alterados: n });
    if (n.compras + n.gastos + n.recorrentes) NT.avisar(perfil.email, 'categoria', 'Categoria "' + de + '" agora é "' + para + '"', P.primeiroNome(perfil.nome) + ' renomeou a categoria em ' + (n.compras + n.gastos + n.recorrentes) + ' lançamento(s).', 'categorias', {}, '');
    return { ok: true, alterados: n, total: tot };
  }
  return { sugestoes: sugestoes, lista: lista, renomear: renomear };
})();
function CATEGORIAS_PADRAO_() { return ['Mercado', 'Restaurante / delivery', 'Casa', 'Contas fixas', 'Transporte', 'Saúde', 'Lazer', 'Pets', 'Educação', 'Vestuário', 'Viagem', 'Presentes', 'Assinaturas', 'Outros']; }

// ================================================================ BUSCA
var BUSCA = (function () {
  function buscar(q, f, ve) {
    var normT = function (x) { return String(x == null ? '' : x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' '); };
    var termos = normT(q).split(' ').filter(function (t) { return t.length >= 2; });
    var num = String(q || '').match(/^\s*(?:r\$\s*)?(\d{1,7}(?:[.,]\d{1,2})?)\s*$/i), alvoC = num ? Math.round(Number(num[1].replace(/\./g, '').replace(',', '.')) * 100) : null;
    if (num && /\./.test(num[1]) && !/,/.test(num[1]) && num[1].split('.')[1].length <= 2) alvoC = Math.round(Number(num[1]) * 100);
    if (alvoC != null) termos = [];
    if (!termos.length && alvoC == null && !f.categoria) throw erro_(400, 'Digite o que procura (ao menos 2 letras), um valor ou escolha uma categoria.');
    var de = U.mesValido(f.de) ? f.de : '', ate = U.mesValido(f.ate) ? f.ate : '', cat = f.categoria ? normCat_(f.categoria) : '', tipo = f.tipo || '';
    var bate = function (txt, cents) {
      if (alvoC != null) return Math.abs(cents) === alvoC;
      if (!termos.length) return true;
      var t = ' ' + normT(txt) + ' ';
      return termos.every(function (x) { return t.indexOf(x) >= 0; });
    };
    var cart = D.mapa('cartoes'), out = [];
    var dentro = function (data) { var m = String(data || '').slice(0, 7); return (!de || m >= de) && (!ate || m <= ate); };
    if (!tipo || tipo === 'CARTAO') D.todos('compras').forEach(function (x) {
      var car = cart[x.cartao_id]; if (!car || !R.visivel(car.titular, x.divisao, ve) || !dentro(x.data_compra) || (cat && normCat_(x.categoria) !== cat)) return;
      var c = U.centavos(x.valor_total); if (isNaN(c)) return;
      if (!bate([x.descricao, x.categoria, x.obs, car.nome, x.terceiro].join(' '), c)) return;
      var t = R.terceiroDe(x), parte = R.minhaParte({ c: c, t: t, pagador: car.titular, divisao: x.divisao }, ve);
      out.push({ tipo: 'CARTAO', id: x.id, data: x.data_compra, descricao: x.descricao, categoria: x.categoria || '', onde: R.nomeCartao(car), detalhe: Number(x.parcelas) > 1 ? x.parcelas + 'x' : 'à vista', pagador: car.titular, divisao: x.divisao, valor: U.reais(c), minha_parte: U.reais(parte), mes: String(x.primeira_fatura || '').slice(0, 7) });
    });
    if (!tipo || tipo === 'PIX') D.todos('gastos').forEach(function (x) {
      if (!R.visivel(x.pago_por, x.divisao, ve) || !dentro(x.data) || (cat && normCat_(x.categoria) !== cat)) return;
      var c = U.centavos(x.valor); if (isNaN(c) || !bate([x.descricao, x.categoria, x.obs].join(' '), c)) return;
      out.push({ tipo: 'PIX', id: x.id, data: x.data, descricao: x.descricao, categoria: x.categoria || '', onde: { PIX: 'Pix', DEBITO: 'Débito', DINHEIRO: 'Dinheiro' }[x.forma] || x.forma, detalhe: '', pagador: x.pago_por, divisao: x.divisao, valor: U.reais(c), minha_parte: U.reais(R.minhaParte({ c: c, pagador: x.pago_por, divisao: x.divisao }, ve)), mes: String(x.data).slice(0, 7) });
    });
    if (!tipo || tipo === 'FIXO') D.todos('recorrentes').forEach(function (x) {
      if (!R.visivel(x.dono, x.divisao, ve) || (cat && normCat_(x.categoria) !== cat)) return;
      var c = U.centavos(x.valor); if (isNaN(c) || !bate([x.descricao, x.categoria, x.obs].join(' '), c)) return;
      var car = x.tipo === 'CARTAO' ? cart[x.cartao_id] : null, pag = car ? car.titular : x.dono;
      // um gasto fixo conta em cada mês em que esteve ativo (dentro do período pedido; até o mês atual)
      var ini = String(x.inicio).slice(0, 7), fimR = U.mesValido(String(x.fim || '').slice(0, 7)) ? String(x.fim).slice(0, 7) : U.mesAtual(), ma = U.mesAtual();
      var a = de && de > ini ? de : ini, b = [fimR, ma, ate || '9999-12'].sort()[0], n = a <= b ? U.difMeses(a, b) + 1 : 0;
      out.push({ tipo: 'FIXO', id: x.id, data: ini + '-' + U.pad(Math.min(Number(x.dia) || 1, 28)), descricao: x.descricao, categoria: x.categoria || '', onde: car ? R.nomeCartao(car) : ({ PIX: 'Pix', DEBITO: 'Débito', DINHEIRO: 'Dinheiro' }[x.forma] || x.forma),
        detalhe: 'fixo · ' + n + ' mês(es)', pagador: pag, divisao: x.divisao, valor: U.reais(c * n), valor_mes: U.reais(c), minha_parte: U.reais(R.minhaParte({ c: c * n, pagador: pag, divisao: x.divisao }, ve)), mes: ini, meses: n });
    });
    out.sort(function (a, b) { return ORD_TXT_(String(b.data), String(a.data)); });
    var tot = out.reduce(function (s, x) { return s + U.centavos(x.valor); }, 0), parte = out.reduce(function (s, x) { return s + U.centavos(x.minha_parte); }, 0);
    var porMes = {}; out.forEach(function (x) { if (x.tipo === 'FIXO') return; var m = String(x.data).slice(0, 7); porMes[m] = (porMes[m] || 0) + U.centavos(x.minha_parte); });
    var porAno = {}; Object.keys(porMes).forEach(function (m) { porAno[m.slice(0, 4)] = (porAno[m.slice(0, 4)] || 0) + porMes[m]; });
    return { n: out.length, itens: out.slice(0, 400), cortado: out.length > 400, total: U.reais(tot), minha_parte: U.reais(parte),
      por_ano: Object.keys(porAno).sort().reverse().map(function (a) { return { ano: a, minha_parte: U.reais(porAno[a]) }; }) };
  }
  return { buscar: buscar };
})();

// ================================================================ VENCIMENTOS e gastos fixos pagos
var VENC = (function () {
  function idPag(recId, mes) { return recId + '|' + mes; }
  function pagamento(recId, mes) { var p = D.porId('pagamentos', idPag(recId, mes)); return p && p.pago === 1 ? p : null; }
  function marcarFixo(recId, mes, pago, perfil) {
    var rc = D.porId('recorrentes', recId); if (!rc || rc.tipo !== 'PIX') throw erro_(404, 'Gasto fixo não encontrado.');
    if (rc.dono !== perfil.email) throw erro_(403, 'Só quem paga este gasto fixo marca o pagamento.');
    if (!U.mesValido(mes) || !R.recNoMes(rc, mes)) throw erro_(400, 'Este gasto fixo não está ativo em ' + U.rotuloMes(mes) + '.');
    var id = idPag(recId, mes), at = D.porId('pagamentos', id), agora = D.agoraISO();
    var o = { id: id, recorrente_id: recId, mes: mes, pago: pago ? 1 : 0, pago_em: pago ? D.hojeISO() : '', pago_por: pago ? perfil.email : '' };
    if (at) { var n = copia_(at); Object.keys(o).forEach(function (k) { n[k] = o[k]; }); D.atualizar('pagamentos', n); } else D.inserir('pagamentos', o);
    D.auditar(perfil.email, pago ? 'Marcou gasto fixo como pago' : 'Desmarcou pagamento de gasto fixo', 'recorrentes', recId, { mes: mes, descricao: rc.descricao, quando: agora.slice(0, 10) });
    return { ok: true, pago: !!pago, pago_em: o.pago_em };
  }
  /** Tudo o que vence no mês para quem está vendo: suas faturas, seus gastos fixos de pix/débito, o acerto e (como entrada) seus ganhos. */
  function itens(mes, ve) {
    var hoje = D.hojeISO(), out = [];
    var st = function (data, pago) { return pago ? 'pago' : data < hoje ? 'atrasado' : data === hoje ? 'hoje' : 'a_vencer'; };
    R.faturasDoMes(mes, ve).forEach(function (f) {
      if (f.titular !== ve || !(f.total > 0)) return;
      out.push({ tipo: 'FATURA', id: f.id, data: f.vencimento, descricao: 'Fatura ' + f.nome, valor: f.total, pago: !!f.paga, pago_em: f.paga_em || '', situacao: st(f.vencimento, f.paga), rota: 'faturas', query: { cartao: f.id, mes: mes } });
    });
    R.gastosFixosDoMes(mes, ve).forEach(function (x) {
      if (x.pago_por !== ve) return; var p = pagamento(x.id, mes);
      out.push({ tipo: 'FIXO', id: x.id, data: x.data, descricao: x.descricao, forma: x.forma, categoria: x.categoria, valor: U.centavos(x.valor) / 100, pago: !!p, pago_em: p ? p.pago_em : '', situacao: st(x.data, !!p), rota: 'fixos', query: {} });
    });
    var ac = R.acerto(mes), dias = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).getUTCDate(), fimMes = mes + '-' + U.pad(dias);
    if (ac.pendente && (ac.pendente.devedor.email === ve || ac.pendente.credor.email === ve)) {
      var devo = ac.pendente.devedor.email === ve;
      out.push({ tipo: 'ACERTO', id: mes, data: fimMes, descricao: devo ? 'Acerto: pagar a ' + P.primeiroNome(ac.pendente.credor.nome) : 'Acerto: receber de ' + P.primeiroNome(ac.pendente.devedor.nome), valor: ac.pendente.valor, entrada: !devo, pago: false, situacao: st(fimMes, false), rota: 'acerto', query: { mes: mes } });
    }
    PN.rendasDe(mes, ve).forEach(function (r) {
      var data = mes + '-' + U.pad(Math.min(Number(r.dia) || 5, dias));
      out.push({ tipo: 'GANHO', id: r.id, data: data, descricao: r.descricao, valor: U.centavos(r.valor) / 100, entrada: true, pago: data <= hoje, situacao: data <= hoje ? 'recebido' : 'a_receber', rota: 'ganhos', query: {} });
    });
    out.sort(function (a, b) { return ORD_TXT_(a.data, b.data) || (a.entrada ? 1 : 0) - (b.entrada ? 1 : 0) || ORD_PT_(a.descricao, b.descricao); });
    var soma = function (fn) { return U.reais(out.filter(fn).reduce(function (s, x) { return s + Math.round(x.valor * 100); }, 0)); };
    var saida = function (x) { return !x.entrada; };
    return { mes: mes, rotulo: U.rotuloMes(mes), hoje: hoje, itens: out, fechado: FECH.info(mes),
      totais: { a_pagar: soma(function (x) { return saida(x) && !x.pago; }), pago: soma(function (x) { return saida(x) && x.pago; }), atrasado: soma(function (x) { return saida(x) && x.situacao === 'atrasado'; }),
        entradas: soma(function (x) { return x.entrada && x.tipo === 'GANHO'; }), n_atrasados: out.filter(function (x) { return saida(x) && x.situacao === 'atrasado'; }).length } };
  }
  return { pagamento: pagamento, marcarFixo: marcarFixo, itens: itens };
})();

// ================================================================ PREVISÃO DO FIM DO MÊS e TETO DO MÊS (orçamento geral)
var PREV = (function () {
  function chaveTeto(email) { return 'orcamento|' + email; }
  function teto(email) { var c = U.centavos(D.config(chaveTeto(email), '')); return isNaN(c) || c <= 0 ? 0 : c; }
  function definirTeto(valor, perfil) {
    var c = valor === '' || valor == null ? 0 : U.centavos(valor); if (isNaN(c) || c < 0 || c > 1e10) throw erro_(400, 'Informe o teto do mês (ou deixe vazio para tirar).');
    D.definirConfig(chaveTeto(perfil.email), c ? String(U.reais(c)) : '');
    D.auditar(perfil.email, c ? 'Definiu o teto de gastos do mês' : 'Tirou o teto de gastos do mês', 'config', 'orcamento', { valor: U.reais(c) });
    return { ok: true, teto: U.reais(c) };
  }
  function diasNoMes(mes) { return new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).getUTCDate(); }
  /**
   * Previsão da sua parte dos gastos no fim do mês (só para o mês atual):
   *  • já lançado: tudo o que já está no mês (faturas que vencem nele, pix/débito, gastos fixos);
   *  • pix/débito do dia a dia (não fixos): no ritmo deste mês (a partir do 7º dia) ou na média dos 3 meses anteriores;
   *  • compras novas no cartão que ainda entram na fatura deste mês (cartões cuja fatura ainda não fechou): média diária dos últimos 90 dias.
   */
  function previsao(idx, mes, ve, totalAtual) {
    var hoje = D.hojeISO(); if (mes !== hoje.slice(0, 7)) return null;
    var dia = Number(hoje.slice(8, 10)), dias = diasNoMes(mes), rest = dias - dia;
    var pixVar = function (m, ateDia) { return (idx[m] || []).filter(function (it) { return it.origem === 'PIX' && !it.recorrente && (!ateDia || String(it.data) <= ateDia); }).reduce(function (s, it) { return s + R.minhaParte(it, ve); }, 0); };
    var ateHoje = pixVar(mes, hoje), media3 = 0; for (var k = 1; k <= 3; k++) media3 += pixVar(U.somarMeses(mes, -k)); media3 = media3 / 3;
    var ritmo = dia >= 7 ? ateHoje / dia : media3 / dias, estPix = Math.max(0, Math.round(ritmo * rest));
    // cartão: compras novas que ainda entram na fatura que vence neste mês
    var cart = D.todos('cartoes').filter(function (c) { return c.ativo !== 0 && c.titular === ve; }), estCart = 0, cartoesAbertos = [];
    if (cart.length) {
      var desde = new Date(Date.now() - 90 * 864e5 - 3 * 3600e3).toISOString().slice(0, 10), base = {};
      D.todos('compras').forEach(function (cp) {
        if (String(cp.data_compra) < desde || String(cp.data_compra) > hoje) return; var c = U.centavos(cp.valor_total); if (isNaN(c)) return;
        var n = Math.max(1, Number(cp.parcelas) || 1), p1 = Math.round((c - R.terceiroDe(cp)) / n);
        base[cp.cartao_id] = (base[cp.cartao_id] || 0) + R.minhaParte({ c: p1, pagador: ve, divisao: cp.divisao }, ve);
      });
      cart.forEach(function (c) {
        var fech = Number(c.dia_fechamento) || 1, venc = Number(c.dia_vencimento) || 10;
        // a fatura que vence neste mês fecha neste mês (fechamento antes do vencimento) ou no mês anterior
        var fechaEsteMes = fech < venc; if (!fechaEsteMes || dia >= fech) return;
        var d = fech - dia; estCart += Math.round((base[c.id] || 0) / 90 * d); cartoesAbertos.push(R.nomeCartao(c));
      });
    }
    var previsto = totalAtual + estPix + estCart;
    return { dia: dia, dias: dias, restantes: rest, lancado: U.reais(totalAtual), estimado_pix: U.reais(estPix), estimado_cartao: U.reais(estCart), previsto: U.reais(previsto),
      base_pix: dia >= 7 ? 'ritmo' : 'media', cartoes_abertos: cartoesAbertos };
  }
  function situacaoTeto(email, gastoC, previstoC) {
    var t = teto(email); if (!t) return null;
    var pct = Math.round(gastoC / t * 1000) / 10, pp = previstoC != null ? Math.round(previstoC / t * 1000) / 10 : null;
    return { teto: U.reais(t), gasto: U.reais(gastoC), resta: U.reais(t - gastoC), pct: pct, previsto_pct: pp, nivel: pct >= 100 ? 'estourou' : pct >= 80 ? 'atencao' : (pp != null && pp >= 100 ? 'previsao' : 'ok') };
  }
  return { teto: teto, definirTeto: definirTeto, previsao: previsao, situacaoTeto: situacaoTeto };
})();

// ================================================================ ASSINATURAS (compras que se repetem todo mês)
var ASSIN = (function () {
  function chaveIgn(email) { return 'assin_ignoradas|' + email; }
  function ignoradas(email) { try { var l = JSON.parse(D.config(chaveIgn(email), '[]') || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
  function ignorar(chave, perfil) {
    chave = U.texto(chave, 80); if (!chave) throw erro_(400, 'Pedido inválido.');
    var l = ignoradas(perfil.email); if (l.indexOf(chave) < 0) l.push(chave); D.definirConfig(chaveIgn(perfil.email), JSON.stringify(l.slice(-300))); return { ok: true };
  }
  function mediana(v) { var s = v.slice().sort(function (a, b) { return a - b; }), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); }
  /** Lançamentos seus (à vista no cartão ou pix/débito) que aparecem em ao menos 3 dos últimos 6 meses com valor parecido e ainda não são gasto fixo. */
  function detectar(ve) {
    var hoje = D.hojeISO(), ma = hoje.slice(0, 7), desde = U.somarMeses(ma, -5), cart = D.mapa('cartoes'), grupos = {};
    var fixos = {}; D.todos('recorrentes').forEach(function (r) { if (r.dono === ve && (!r.fim || String(r.fim) >= ma)) fixos[chaveDesc_(r.descricao).slice(0, 2).join(' ')] = 1; });
    var ign = {}; ignoradas(ve).forEach(function (k) { ign[k] = 1; });
    var add = function (x) { var k = chaveDesc_(x.descricao).slice(0, 2).join(' '); if (!k || fixos[k] || ign[k]) return; (grupos[k] = grupos[k] || []).push(x); };
    D.todos('compras').forEach(function (cp) {
      var car = cart[cp.cartao_id]; if (!car || car.titular !== ve || Number(cp.parcelas) > 1) return; var m = String(cp.data_compra).slice(0, 7); if (m < desde || m > ma) return;
      var c = U.centavos(cp.valor_total); if (isNaN(c) || c <= 0) return;
      add({ origem: 'CARTAO', cartao_id: cp.cartao_id, onde: R.nomeCartao(car), descricao: cp.descricao, categoria: cp.categoria || '', divisao: cp.divisao, data: cp.data_compra, mes: m, c: c });
    });
    D.todos('gastos').forEach(function (g) {
      if (g.pago_por !== ve) return; var m = String(g.data).slice(0, 7); if (m < desde || m > ma) return;
      var c = U.centavos(g.valor); if (isNaN(c) || c <= 0) return;
      add({ origem: 'PIX', forma: g.forma, onde: { PIX: 'Pix', DEBITO: 'Débito', DINHEIRO: 'Dinheiro' }[g.forma] || g.forma, descricao: g.descricao, categoria: g.categoria || '', divisao: g.divisao, data: g.data, mes: m, c: c });
    });
    var out = [];
    Object.keys(grupos).forEach(function (k) {
      var l = grupos[k].sort(function (a, b) { return ORD_TXT_(a.data, b.data); }), porMes = {};
      l.forEach(function (x) { porMes[x.mes] = x; });   // vale o último de cada mês
      var meses = Object.keys(porMes).sort(); if (meses.length < 3) return;
      var vals = meses.map(function (m) { return porMes[m].c; }), med = mediana(vals);
      if (!vals.every(function (v) { return Math.abs(v - med) <= Math.max(med * 0.3, 300); })) return;   // valores parecidos (±30%)
      if (Object.keys(porMes).length < l.length * 0.6) return;   // várias vezes no mesmo mês: é compra frequente, não assinatura
      var ult = porMes[meses[meses.length - 1]], ant = porMes[meses[meses.length - 2]];
      var aum = ult.c > ant.c * 1.03 && ult.c - ant.c >= 100 ? { de: U.reais(ant.c), para: U.reais(ult.c), pct: Math.round((ult.c - ant.c) / ant.c * 1000) / 10, mes: ult.mes } : null;
      out.push({ chave: k, descricao: ult.descricao, categoria: ult.categoria, origem: ult.origem, cartao_id: ult.cartao_id || '', forma: ult.forma || '', onde: ult.onde, divisao: ult.divisao || 'INDIVIDUAL',
        valor: U.reais(ult.c), media: U.reais(Math.round(vals.reduce(function (s, v) { return s + v; }, 0) / vals.length)), dia: Number(String(ult.data).slice(8, 10)) || 1,
        meses: meses, rotulos: meses.map(function (m) { return U.rotuloMes(m); }), ultimo_mes: ult.mes, proximo_mes: U.somarMeses(ult.mes, 1), aumento: aum, por_ano: U.reais(ult.c * 12) });
    });
    return out.sort(function (a, b) { return (b.aumento ? 1 : 0) - (a.aumento ? 1 : 0) || U.centavos(b.valor) - U.centavos(a.valor); });
  }
  /** Para o Início: quantas sugestões e os aumentos de valor (mês atual). */
  function resumo(ve) { var l = detectar(ve); return { n: l.length, aumentos: l.filter(function (x) { return x.aumento; }).slice(0, 3).map(function (x) { return { descricao: x.descricao, de: x.aumento.de, para: x.aumento.para, pct: x.aumento.pct }; }) }; }
  return { detectar: detectar, ignorar: ignorar, resumo: resumo };
})();

// ================================================================ ROTAS
rota_('GET', '/api/busca', {}, function (c) { return BUSCA.buscar(c.query.q, { de: c.query.de, ate: c.query.ate, categoria: c.query.categoria, tipo: c.query.tipo }, c.perfil.email); });
rota_('GET', '/api/categorias', {}, function (c) { return CATS.lista(c.perfil.email); });
rota_('POST', '/api/categorias/renomear', {}, function (c) { return CATS.renomear(c.body.de, c.body.para, c.perfil); });
rota_('POST', '/api/desfazer', {}, function (c) { return DESF.desfazer(c.body.token, c.perfil); });
rota_('GET', '/api/meses/fechados', {}, function () { return { meses: FECH.fechados().map(FECH.info) }; });
rota_('POST', '/api/meses/(\\d{4}-\\d{2})/fechar', {}, function (c, mes) { return FECH.fechar(mes, c.perfil); });
rota_('POST', '/api/meses/(\\d{4}-\\d{2})/reabrir', {}, function (c, mes) { return FECH.reabrir(mes, c.perfil); });
rota_('GET', '/api/vencimentos', {}, function (c) { return VENC.itens(mesQuery_(c.query), c.perfil.email); });
rota_('PUT', '/api/fixos/(REC-\\d+)/(\\d{4}-\\d{2})/pago', {}, function (c, id, mes) { return VENC.marcarFixo(id, mes, c.body.pago !== false, c.perfil); });
rota_('PUT', '/api/orcamento', {}, function (c) { return PREV.definirTeto(c.body.valor, c.perfil); });
rota_('GET', '/api/assinaturas', {}, function (c) { return { itens: ASSIN.detectar(c.perfil.email) }; });
rota_('POST', '/api/assinaturas/ignorar', {}, function (c) { return ASSIN.ignorar(c.body.chave, c.perfil); });
