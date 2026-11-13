/**
 * Ganhos, painel do Início, limites por categoria, evolução de 12 meses e reserva de emergência.
 *
 * PRIVACIDADE: o painel é sempre de quem está vendo ("ve"). Do outro aparecem só os ganhos (combinado entre vocês)
 * e o acerto — nunca o total gasto, faturas ou gastos individuais dele.
 *
 *  • GANHO: de uma pessoa; FIXO (todo mês, de "inicio" até "fim" — ex.: salário) ou AVULSO (só num mês — ex.: 13º).
 *  • SUA PARTE de cada gasto: o que você pagou menos o que o outro lhe devolve no acerto, ou o que você deve ao outro.
 *    (Uma compra dividida de R$ 100 no cartão do Pedro pesa R$ 50 para cada um.)
 *  • DISPONÍVEL = seus ganhos − sua parte dos gastos do mês − sua parte nas metas.
 *  • LIMITE por categoria: teto mensal de cada pessoa, comparado com a sua parte dos gastos da categoria.
 */
var PN = (function () {
  function mesDe(v) { return String(v == null ? '' : v).slice(0, 7); }
  function noMes(r, mes) { var ini = mesDe(r.inicio), fim = mesDe(r.fim); return U.mesValido(ini) && mes >= ini && (!U.mesValido(fim) || mes <= fim); }
  function rendasDoMes(mes) { return D.todos('rendas').filter(function (r) { return noMes(r, mes); }); }
  function rendaPorPessoa(mes) { var t = {}; rendasDoMes(mes).forEach(function (r) { t[r.pessoa] = (t[r.pessoa] || 0) + (U.centavos(r.valor) || 0); }); return t; }
  function normCat(c) { return String(c || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  /** Sua parte (centavos) de tudo no mês, e por categoria. */
  function suaParte(idx, mes, email) {
    var total = 0, cats = {}, nomes = {};
    (idx[mes] || []).forEach(function (it) {
      var v = R.minhaParte(it, email); if (!v) return; total += v;
      var nome = it.categoria || 'Sem categoria', k = normCat(nome); cats[k] = (cats[k] || 0) + v; if (!nomes[k]) nomes[k] = nome;
    });
    return { total: total, cats: cats, nomes: nomes };
  }
  function aportesNoMes(mes, email) { return D.todos('aportes').reduce(function (s, a) { return String(a.data).slice(0, 7) === mes && a.quem === email ? s + (U.centavos(a.valor) || 0) : s; }, 0); }
  function mediaGastos(mes, idx, email) { var s = 0; for (var k = 1; k <= 3; k++) s += suaParte(idx, U.somarMeses(mes, -k), email).total; return Math.round(s / 3); }
  /** Capacidade de poupança por pessoa: ganhos do mês − média da sua parte dos gastos nos 3 meses anteriores. */
  function capacidade(mes, idx) {
    idx = idx || R.indice(); var renda = rendaPorPessoa(mes), out = {};
    P.ativos().forEach(function (u) { var m = mediaGastos(mes, idx, u.email); out[u.email] = { renda: renda[u.email] || 0, media_gastos: m, capacidade: (renda[u.email] || 0) - m }; });
    return out;
  }

  // ---------- limites por categoria ----------
  function limitesDe(email) { return D.todos('limites').filter(function (l) { return l.dono === email; }); }
  function situacaoLimites(idx, mes, email) {
    var parte = suaParte(idx, mes, email);
    return limitesDe(email).map(function (l) {
      var teto = U.centavos(l.valor), gasto = parte.cats[normCat(l.categoria)] || 0, pct = teto > 0 ? Math.round(gasto / teto * 1000) / 10 : 0;
      return { id: l.id, categoria: l.categoria, teto: U.reais(teto), gasto: U.reais(gasto), resta: U.reais(teto - gasto), pct: pct, nivel: pct >= 100 ? 'estourou' : pct >= 80 ? 'atencao' : 'ok', obs: l.obs || '' };
    }).sort(function (a, b) { return b.pct - a.pct; });
  }
  function validarLimite(b, atual, perfil) {
    var cat = U.texto(b.categoria !== undefined ? b.categoria : atual && atual.categoria, 40); if (cat.length < 2) throw erro_(400, 'Informe a categoria (a mesma usada nos lançamentos).');
    var c = U.centavos(b.valor !== undefined ? b.valor : atual && atual.valor); if (isNaN(c) || c <= 0 || c > 1e10) throw erro_(400, 'Informe o teto mensal.');
    var rep = limitesDe(perfil.email).some(function (l) { return (!atual || l.id !== atual.id) && normCat(l.categoria) === normCat(cat); });
    if (rep) throw erro_(409, 'Você já tem um limite para esta categoria.');
    return { categoria: cat, valor: U.reais(c), obs: U.texto(b.obs !== undefined ? b.obs : atual && atual.obs, 200), dono: perfil.email };
  }

  // ---------- evolução (12 meses) ----------
  function evolucao(mes, email, idx) {
    idx = idx || R.indice(); var out = [];
    for (var k = 11; k >= 0; k--) {
      var m = U.somarMeses(mes, -k), r = rendaPorPessoa(m)[email] || 0, g = suaParte(idx, m, email).total, a = aportesNoMes(m, email);
      out.push({ mes: m, rotulo: U.rotuloMes(m), ganhos: U.reais(r), gastos: U.reais(g), guardado: U.reais(a), saldo: U.reais(r - g - a) });
    }
    return out;
  }

  // ---------- reserva de emergência ----------
  /** Sugestão: 6 meses dos gastos do casal (média dos 3 últimos meses), arredondada para cima em R$ 1.000. */
  function reservaSugerida(mes) {
    var idx = R.indice(), soma = 0; P.ativos().forEach(function (u) { soma += mediaGastos(mes, idx, u.email); });
    var seis = soma * 6, arred = Math.ceil(seis / 100000) * 100000;
    var existente = D.todos('metas').filter(function (m) { return m.categoria === 'RESERVA' && m.ativa !== 0; })[0];
    return { meses: 6, valor: U.reais(arred), base_mensal_arredondada: U.reais(Math.round(soma / 1000) * 1000), tem_dados: soma > 0, meta_existente: existente ? (function () { var o = {}; Object.keys(existente).forEach(function (k) { if (k !== '_r') o[k] = existente[k]; }); return o; })() : null };
  }

  // ---------- painel do Início ----------
  function painel(mes, ve) {
    var idx = R.indice(), us = P.ativos(), ac = R.acertoComIndice(mes, idx), renda = rendaPorPessoa(mes), metas = M.listar(mes);
    var metasPessoa = {}; metas.pessoas.forEach(function (p) { metasPessoa[p.email] = U.centavos(p.por_mes); });
    var eu = us.filter(function (u) { return u.email === ve; })[0] || { email: ve, nome: P.nomeDe(ve) }, outro = us.filter(function (u) { return u.email !== ve; })[0];
    var parte = suaParte(idx, mes, ve), pAc = ac.pessoas.filter(function (p) { return p.email === ve; })[0], oAc = ac.pessoas.filter(function (p) { return p.email !== ve; })[0];
    var minhas = (idx[mes] || []).filter(function (it) { return it.pagador === ve; });
    var cartao = minhas.filter(function (it) { return it.origem === 'CARTAO'; }).reduce(function (s, it) { return s + it.c; }, 0), pix = minhas.filter(function (it) { return it.origem === 'PIX'; }).reduce(function (s, it) { return s + it.c; }, 0);
    var terc = minhas.reduce(function (s, it) { return s + (it.t || 0); }, 0);
    var r = renda[ve] || 0, mt = metasPessoa[ve] || 0, disp = r - parte.total - mt;
    var voce = { email: ve, nome: eu.nome, renda: U.reais(r), cartao: U.reais(cartao), pix: U.reais(pix), receber: pAc ? pAc.receber : 0, pagar: oAc ? oAc.receber : 0, terceiros: U.reais(terc),
      gasto: U.reais(parte.total), metas: U.reais(mt), disponivel: U.reais(disp), uso_renda: r > 0 ? Math.round((parte.total + mt) / r * 1000) / 10 : null };
    var parceiro = outro ? { email: outro.email, nome: outro.nome, renda: U.reais(renda[outro.email] || 0), metas: U.reais(metasPessoa[outro.email] || 0) } : null;
    var categorias = Object.keys(parte.cats).map(function (k) { return { nome: parte.nomes[k], valor: U.reais(parte.cats[k]) }; }).filter(function (c) { return c.valor > 0; }).sort(function (a, b) { return b.valor - a.valor; });
    var antes = suaParte(idx, U.somarMeses(mes, -1), ve).total;
    var prox = U.somarMeses(mes, 1), comprometido = (idx[prox] || []).filter(function (it) { return it.origem === 'CARTAO' || it.recorrente; }).reduce(function (s, it) { return s + R.minhaParte(it, ve); }, 0);
    var rendaProx = rendaPorPessoa(prox)[ve] || 0, hoje = D.hojeISO();
    var contas = R.faturasDoMes(mes, ve).filter(function (f) { return f.titular === ve && f.total > 0; }).map(function (f) { return { tipo: 'FATURA', descricao: 'Fatura ' + f.nome, dono: f.titular, dono_nome: f.titular_nome, data: f.vencimento, valor: f.total, paga: f.paga }; })
      .concat(R.gastosFixosDoMes(mes, ve).filter(function (x) { return x.pago_por === ve; }).map(function (x) { return { tipo: 'FIXO', descricao: x.descricao, dono: x.pago_por, dono_nome: P.nomeDe(x.pago_por), data: x.data, valor: x.valor, paga: x.data <= hoje }; }))
      .sort(function (a, b) { return String(a.data).localeCompare(String(b.data)); });
    return { mes: mes, rotulo: U.rotuloMes(mes), tem_rendas: D.todos('rendas').length > 0, voce: voce, parceiro: parceiro,
      casal: { renda: U.reais(Object.keys(renda).reduce(function (s, k) { return s + renda[k]; }, 0)), metas: metas.total_por_mes },
      categorias: categorias, limites: situacaoLimites(idx, mes, ve),
      comparacao: { rotulo_anterior: U.rotuloMes(U.somarMeses(mes, -1)), gasto_anterior: U.reais(antes), gasto_atual: U.reais(parte.total), variacao: antes > 0 ? Math.round((parte.total - antes) / antes * 1000) / 10 : null },
      proximo: { mes: prox, rotulo: U.rotuloMes(prox), comprometido: U.reais(comprometido), renda: U.reais(rendaProx), pct: rendaProx > 0 ? Math.round(comprometido / rendaProx * 1000) / 10 : null },
      contas: contas, evolucao: evolucao(mes, ve, idx), dias_no_mes: new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).getUTCDate() };
  }

  // ---------- cadastro de ganhos ----------
  function validar(b, atual, perfil) {
    var g = function (k) { return b[k] !== undefined ? b[k] : (atual ? atual[k] : undefined); };
    var v = { tipo: String(g('tipo') || 'FIXA'), descricao: U.texto(g('descricao'), 80), obs: U.texto(g('obs'), 300), dia: parseInt(g('dia'), 10) || 5, inicio: mesDe(g('inicio')), fim: mesDe(g('fim') || '') };
    if (v.tipo !== 'FIXA' && v.tipo !== 'AVULSA') v.tipo = 'FIXA';
    if (v.descricao.length < 2) throw erro_(400, 'Descreva o ganho (ex.: Salário, Freela, 13º).');
    var c = U.centavos(g('valor')); if (isNaN(c) || c <= 0 || c > 1e11) throw erro_(400, 'Informe o valor recebido.'); v.valor = U.reais(c);
    if (!(v.dia >= 1 && v.dia <= 31)) v.dia = 5;
    if (!U.mesValido(v.inicio)) throw erro_(400, v.tipo === 'AVULSA' ? 'Informe o mês em que recebeu.' : 'Informe a partir de quando recebe.');
    if (v.tipo === 'AVULSA') v.fim = v.inicio;
    if (v.fim && !U.mesValido(v.fim)) v.fim = '';
    if (v.fim && v.fim < v.inicio) throw erro_(400, 'O último mês não pode ser antes do primeiro.');
    v.pessoa = atual ? atual.pessoa : perfil.email;
    return v;
  }
  function listar(mes) {
    var itens = D.todos('rendas').map(function (r) { var o = {}; Object.keys(r).forEach(function (k) { if (k !== '_r') o[k] = r[k]; }); o.pessoa_nome = P.nomeDe(r.pessoa);
      o.situacao = noMes(r, mes) ? 'ativo' : (r.inicio > mes ? 'futuro' : 'encerrado'); return o; })
      .sort(function (a, b) { var ord = { ativo: 0, futuro: 1, encerrado: 2 }; return ord[a.situacao] - ord[b.situacao] || a.pessoa_nome.localeCompare(b.pessoa_nome, 'pt-BR') || b.valor - a.valor; });
    var tot = rendaPorPessoa(mes);
    return { mes: mes, rotulo: U.rotuloMes(mes), itens: itens, total: U.reais(Object.keys(tot).reduce(function (s, k) { return s + tot[k]; }, 0)),
      pessoas: P.ativos().map(function (u) { return { email: u.email, nome: u.nome, total: U.reais(tot[u.email] || 0) }; }) };
  }
  return { painel: painel, capacidade: capacidade, rendaPorPessoa: rendaPorPessoa, validar: validar, listar: listar, noMes: noMes, suaParte: suaParte,
    situacaoLimites: situacaoLimites, validarLimite: validarLimite, evolucao: evolucao, reservaSugerida: reservaSugerida, aportesNoMes: aportesNoMes, normCat: normCat };
})();
