/**
 * Regras do controle de custos do casal.
 *
 *  • FATURA = mês de VENCIMENTO do cartão (ex.: "2026-11" é a fatura que vence em novembro/2026).
 *  • Compra no cartão: a 1ª parcela cai na fatura sugerida pelo dia da compra e pelo dia de fechamento do cartão
 *    (compra no dia do fechamento ou depois vai para a fatura seguinte). A parcela k cai em primeira_fatura + (k − 1):
 *    por isso as compras parceladas "passam sozinhas" para as faturas dos meses seguintes — nada é copiado.
 *    O valor da parcela é o total ÷ nº de parcelas; os centavos que sobram ficam na 1ª parcela.
 *  • Divisão de cada lançamento (cartão ou pix/débito), sempre do ponto de vista de quem PAGOU:
 *      INDIVIDUAL → só de quem pagou (ninguém deve nada);
 *      DIVIDIDO   → meio a meio (o outro deve a metade);
 *      OUTRO      → todo do(a) parceiro(a) (o outro deve o valor inteiro).
 *  • GASTO FIXO (recorrente): cadastrado uma vez, entra todo mês de "inicio" até "fim" (vazio = sem fim) — na fatura
 *    do cartão (tipo CARTAO, pelo mês da fatura) ou nos pix/débito (tipo PIX, no dia escolhido). Também não é copiado.
 *  • ACERTO DO MÊS: soma o que cada um tem a receber do outro (parcelas das faturas que vencem no mês + pix/débito
 *    feitos no mês), compensa um com o outro e desconta os acertos já registrados → "Fulano deve R$ X a Beltrano".
 */
var R = (function () {
  var DIVISOES = ['INDIVIDUAL', 'DIVIDIDO', 'OUTRO'];
  var FORMAS = ['PIX', 'DEBITO', 'DINHEIRO'];
  var CATEGORIAS_PADRAO = ['Mercado', 'Restaurante / delivery', 'Casa', 'Contas fixas', 'Transporte', 'Saúde', 'Lazer', 'Pets', 'Educação', 'Vestuário', 'Viagem', 'Presentes', 'Assinaturas', 'Outros'];
  var MAX_PARCELAS = 48;

  function mesDe(v) { return String(v == null ? '' : v).slice(0, 7); }
  function diasNoMes(mes) { var a = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7)); return new Date(Date.UTC(a, m, 0)).getUTCDate(); }

  /** Fatura (mês de vencimento) em que cai uma compra feita em dataISO no cartão. */
  function faturaSugerida(cartao, dataISO) {
    var mes = dataISO.slice(0, 7), dia = Number(dataISO.slice(8, 10));
    var fech = Math.min(Number(cartao.dia_fechamento) || 1, diasNoMes(mes)), venc = Number(cartao.dia_vencimento) || 1;
    var mesFechamento = dia < fech ? mes : U.somarMeses(mes, 1);
    return venc > fech ? mesFechamento : U.somarMeses(mesFechamento, 1); // vencimento no mês seguinte ao fechamento
  }
  /** Divide um valor em n partes (centavos); a sobra fica na 1ª. */
  function repartir(total, n) { var base = total >= 0 ? Math.floor(total / n) : Math.ceil(total / n), resto = total - base * n, out = []; for (var k = 1; k <= n; k++) out.push(base + (k === 1 ? resto : 0)); return out; }
  /** Quanto um terceiro paga da compra (centavos, total). */
  function terceiroDe(compra) { var t = compra && compra.terceiro ? U.centavos(compra.terceiro_valor) : 0; return isNaN(t) || t <= 0 ? 0 : t; }
  /** Parcelas de uma compra: [{ n, de, mes, c, t }] (c = centavos na fatura; t = parte do terceiro nessa parcela). */
  function parcelas(compra) {
    var total = U.centavos(compra.valor_total), n = Math.max(1, Math.min(MAX_PARCELAS, Number(compra.parcelas) || 1)), ini = mesDe(compra.primeira_fatura);
    if (!U.mesValido(ini) || isNaN(total)) return [];
    var cs = repartir(total, n), ts = repartir(Math.min(terceiroDe(compra), Math.max(total, 0)), n), out = [];
    for (var k = 1; k <= n; k++) out.push({ n: k, de: n, mes: U.somarMeses(ini, k - 1), c: cs[k - 1], t: ts[k - 1] });
    return out;
  }
  /** Valor que fica com o casal (fatura − terceiro): é ele que se divide. */
  function efetivo(it) { return it.c - (it.t || 0); }
  function ultimaFatura(compra) { return U.somarMeses(mesDe(compra.primeira_fatura), Math.max(1, Number(compra.parcelas) || 1) - 1); }
  /** Quanto o outro deve a quem pagou, em centavos. */
  function parteDoOutro(c, divisao) { return divisao === 'DIVIDIDO' ? Math.round(c / 2) : divisao === 'OUTRO' ? c : 0; }

  function rotuloDivisao(divisao, pagadorEmail) {
    var outro = P.parceiroDe(pagadorEmail), pag = P.primeiroNome(P.nomeDe(pagadorEmail));
    if (divisao === 'DIVIDIDO') return 'Dividido';
    if (divisao === 'OUTRO') return 'Só de ' + (outro ? P.primeiroNome(outro.nome) : 'parceiro(a)');
    return 'Só de ' + pag;
  }

  // ---------- gastos fixos (recorrentes) ----------
  function recNoMes(rc, mes) { var ini = mesDe(rc.inicio), fim = mesDe(rc.fim); return U.mesValido(ini) && mes >= ini && (!U.mesValido(fim) || mes <= fim); }
  function dataRec(rc, mes) { return mes + '-' + U.pad(Math.min(Number(rc.dia) || 1, diasNoMes(mes))); }
  /** Meses em que o gasto fixo entra, de inicio até fim (ou até "ate", para os sem fim). */
  function mesesRec(rc, ate) {
    var ini = mesDe(rc.inicio), fim = mesDe(rc.fim), out = []; if (!U.mesValido(ini)) return out;
    var ult = U.mesValido(fim) && fim < ate ? fim : ate;
    for (var m = ini; m <= ult && out.length < 600; m = U.somarMeses(m, 1)) out.push(m);
    return out;
  }
  function recs(tipo) { return D.todos('recorrentes').filter(function (r) { return !tipo || r.tipo === tipo; }); }
  /** Gastos fixos de pix/débito que caem no mês, no formato dos gastos lançados (marcados com recorrente: true). */
  function gastosFixosDoMes(mes, ve) {
    return recs('PIX').filter(function (rc) { return recNoMes(rc, mes) && visivel(rc.dono, rc.divisao, ve); }).map(function (rc) {
      return { id: rc.id, recorrente: true, data: dataRec(rc, mes), descricao: rc.descricao, categoria: rc.categoria || '', forma: rc.forma, valor: rc.valor, pago_por: rc.dono, divisao: rc.divisao, obs: rc.obs || '', criado_em: rc.criado_em };
    });
  }

  // ---------- índice de lançamentos por mês ----------
  /** Junta parcelas de cartão (pelo mês da fatura) e gastos pix/débito (pelo mês da data) em { 'AAAA-MM': [itens] }. */
  function indice() {
    var idx = {}, cartoes = D.mapa('cartoes');
    var add = function (mes, it) { (idx[mes] = idx[mes] || []).push(it); };
    D.todos('compras').forEach(function (cp) {
      var car = cartoes[cp.cartao_id]; if (!car) return;
      parcelas(cp).forEach(function (p) {
        add(p.mes, { origem: 'CARTAO', id: cp.id, cartao_id: car.id, cartao: car.nome + (car.final ? ' •' + car.final : ''), pagador: car.titular, data: cp.data_compra, descricao: cp.descricao,
          categoria: cp.categoria || '', parcela: p.n + '/' + p.de, n: p.n, de: p.de, c: p.c, t: p.t, terceiro: p.t ? cp.terceiro : '', divisao: cp.divisao || 'INDIVIDUAL' });
      });
    });
    D.todos('gastos').forEach(function (g) {
      var c = U.centavos(g.valor); if (isNaN(c)) return;
      add(mesDe(g.data), { origem: 'PIX', id: g.id, forma: g.forma, pagador: g.pago_por, data: g.data, descricao: g.descricao, categoria: g.categoria || '', c: c, divisao: g.divisao || 'INDIVIDUAL' });
    });
    var ate = U.somarMeses(U.mesAtual(), 24);
    recs().forEach(function (rc) {
      var c = U.centavos(rc.valor), car = rc.tipo === 'CARTAO' ? cartoes[rc.cartao_id] : null; if (isNaN(c) || (rc.tipo === 'CARTAO' && !car)) return;
      mesesRec(rc, ate).forEach(function (m) {
        add(m, rc.tipo === 'CARTAO'
          ? { origem: 'CARTAO', id: rc.id, recorrente: true, cartao_id: car.id, cartao: nomeCartao(car), pagador: car.titular, data: dataRec(rc, m), descricao: rc.descricao, categoria: rc.categoria || '', parcela: 'fixo', c: c, divisao: rc.divisao || 'INDIVIDUAL' }
          : { origem: 'PIX', id: rc.id, recorrente: true, forma: rc.forma, pagador: rc.dono, data: dataRec(rc, m), descricao: rc.descricao, categoria: rc.categoria || '', c: c, divisao: rc.divisao || 'INDIVIDUAL' });
      });
    });
    return idx;
  }
  function acertosPorMes() { var m = {}; D.todos('acertos').forEach(function (a) { var k = mesDe(a.mes); (m[k] = m[k] || []).push(a); }); return m; }

  // ---------- acerto do mês ----------
  function calcularAcerto(mes, idx, acMes) {
    var us = P.ativos();
    var pessoas = us.map(function (u) { return { email: u.email, nome: u.nome, cartao: { total: 0, compartilhado: 0, receber: 0 }, pix: { total: 0, compartilhado: 0, receber: 0 }, receber: 0 }; });
    var porEmail = {}; pessoas.forEach(function (p) { porEmail[p.email] = p; });
    var itens = [];
    (idx[mes] || []).forEach(function (it) {
      var p = porEmail[it.pagador]; if (!p) return;
      var g = it.origem === 'CARTAO' ? p.cartao : p.pix, parte = parteDoOutro(efetivo(it), it.divisao);
      g.total += it.c; if (it.divisao !== 'INDIVIDUAL') g.compartilhado += efetivo(it); g.receber += parte; p.receber += parte;
      if (parte !== 0) itens.push({ origem: it.origem, id: it.id, recorrente: !!it.recorrente, data: it.data, descricao: it.descricao, cartao: it.cartao || '', forma: it.forma || '', parcela: it.parcela || '',
        pagador: it.pagador, pagador_nome: p.nome, divisao: it.divisao, divisao_rotulo: rotuloDivisao(it.divisao, it.pagador), valor: U.reais(it.c), terceiro: it.t ? it.terceiro : '', terceiro_parcela: U.reais(it.t || 0), parte: U.reais(parte) });
    });
    itens.sort(function (a, b) { return String(a.data).localeCompare(String(b.data)) || a.descricao.localeCompare(b.descricao, 'pt-BR'); });
    var acertos = (acMes[mes] || []).map(function (a) { return { id: a.id, de: a.de, de_nome: P.nomeDe(a.de), para: a.para, para_nome: P.nomeDe(a.para), valor: a.valor, data: a.data, obs: a.obs || '', criado_por: a.criado_por }; })
      .sort(function (a, b) { return String(a.data).localeCompare(String(b.data)); });
    var out = { mes: mes, rotulo: U.rotuloMes(mes), pessoas: pessoas.map(function (p) {
      return { email: p.email, nome: p.nome, receber: U.reais(p.receber),
        cartao: { total: U.reais(p.cartao.total), compartilhado: U.reais(p.cartao.compartilhado), receber: U.reais(p.cartao.receber) },
        pix: { total: U.reais(p.pix.total), compartilhado: U.reais(p.pix.compartilhado), receber: U.reais(p.pix.receber) } }; }),
      itens: itens, acertos: acertos, completo: pessoas.length >= 2 };
    if (pessoas.length < 2) { out.devido = 0; out.pago = 0; out.restante = 0; out.restante_abs = 0; out.restante_de = null; out.devedor = null; out.credor = null; out.pendente = null; return out; }
    var a = pessoas[0], b = pessoas[1];
    var bDeveA = a.receber - b.receber; // > 0: b deve a; < 0: a deve b
    var pagoBA = 0; (acMes[mes] || []).forEach(function (x) { var v = U.centavos(x.valor); if (isNaN(v)) return; if (x.de === b.email && x.para === a.email) pagoBA += v; else if (x.de === a.email && x.para === b.email) pagoBA -= v; });
    var restante = bDeveA - pagoBA;
    var devedor = bDeveA >= 0 ? b : a, credor = devedor === b ? a : b;
    out.devedor = bDeveA === 0 ? null : { email: devedor.email, nome: devedor.nome };
    out.credor = bDeveA === 0 ? null : { email: credor.email, nome: credor.nome };
    out.devido = U.reais(Math.abs(bDeveA));
    out.pago = U.reais(bDeveA >= 0 ? pagoBA : -pagoBA);
    out.restante = U.reais(bDeveA >= 0 ? restante : -restante); // em relação a devedor → credor (negativo = pagou a mais)
    out.restante_de = restante === 0 ? null : (restante > 0 ? b.email : a.email); // quem ainda deve
    out.restante_abs = U.reais(Math.abs(restante));
    var dv = restante > 0 ? b : a, cr = dv === b ? a : b; // quem ainda deve a quem, depois dos acertos
    out.pendente = restante === 0 ? null : { devedor: { email: dv.email, nome: dv.nome }, credor: { email: cr.email, nome: cr.nome }, valor: U.reais(Math.abs(restante)) };
    return out;
  }
  function acerto(mes) { return calcularAcerto(mes, indice(), acertosPorMes()); }
  /** Acerto de um mês reaproveitando um índice já montado (painel calcula vários meses de uma vez). */
  function acertoComIndice(mes, idx) { return calcularAcerto(mes, idx, acertosPorMes()); }

  /** Todos os meses com movimento (do mais recente ao mais antigo, até o mês seguinte ao atual), com o saldo de cada um. */
  function historicoAcertos() {
    var idx = indice(), ac = acertosPorMes(), limite = U.somarMeses(U.mesAtual(), 1), meses = {};
    Object.keys(idx).concat(Object.keys(ac)).forEach(function (m) { if (U.mesValido(m) && m <= limite) meses[m] = 1; });
    var us = P.ativos(), lista = Object.keys(meses).sort().reverse().map(function (m) {
      var r = calcularAcerto(m, idx, ac);
      return { mes: m, rotulo: r.rotulo, devido: r.devido, pago: r.pago, restante_abs: r.restante_abs, restante_de: r.restante_de, devedor: r.devedor, credor: r.credor, pendente: r.pendente };
    });
    // saldo em aberto somando todos os meses (positivo = o 2º usuário deve ao 1º)
    var acumulado = 0;
    var mesHoje = U.mesAtual(); // o saldo em aberto soma só os meses até o atual (o próximo ainda não fechou)
    if (us.length >= 2) lista.forEach(function (x) { if (!x.restante_de || x.mes > mesHoje) return; var v = U.centavos(x.restante_abs); acumulado += x.restante_de === us[1].email ? v : -v; });
    var aberto = null;
    if (us.length >= 2 && acumulado !== 0) { var dev = acumulado > 0 ? us[1] : us[0], cre = dev === us[1] ? us[0] : us[1]; aberto = { devedor: { email: dev.email, nome: dev.nome }, credor: { email: cre.email, nome: cre.nome }, valor: U.reais(Math.abs(acumulado)) }; }
    return { meses: lista, aberto: aberto };
  }

  // ---------- faturas ----------
  /**
   * PRIVACIDADE: cada um vê tudo o que é seu e, do outro, só o que é dividido (DIVIDIDO ou OUTRO = "todo de quem vê").
   * "ve" = e-mail de quem está vendo; vazio = sem filtro (uso interno: acerto, e-mails, testes).
   */
  function visivel(dono, divisao, ve) { return !ve || dono === ve || divisao !== 'INDIVIDUAL'; }
  /** Sua parte de um lançamento (centavos): o que pagou menos o que o outro devolve, ou o que você deve ao outro. */
  function minhaParte(it, email) { var e = efetivo(it), outro = parteDoOutro(e, it.divisao); return it.pagador === email ? e - outro : outro; }
  function nomeCartao(car) { return car.nome + (car.final ? ' •' + car.final : ''); }
  function statusFatura(cartaoId, mes) { return D.porId('faturas', cartaoId + '|' + mes); }
  function faturaDetalhe(cartaoId, mes, ve) {
    var car = D.porId('cartoes', cartaoId); if (!car) throw erro_(404, 'Cartão não encontrado.');
    var itens = [], total = 0, comp = 0, receber = 0, terc = 0, restrito = !!ve && car.titular !== ve;
    D.todos('compras').forEach(function (cp) {
      if (cp.cartao_id !== cartaoId || (restrito && cp.divisao === 'INDIVIDUAL')) return;
      parcelas(cp).forEach(function (p) {
        if (p.mes !== mes) return;
        var e = p.c - p.t; total += p.c; terc += p.t; if (cp.divisao !== 'INDIVIDUAL') comp += e; receber += parteDoOutro(e, cp.divisao);
        itens.push({ id: cp.id, data_compra: cp.data_compra, descricao: cp.descricao, categoria: cp.categoria || '', parcela: p.n, parcelas: p.de, valor: U.reais(p.c), valor_total: cp.valor_total,
          terceiro: cp.terceiro && p.t ? cp.terceiro : '', terceiro_valor: p.t ? cp.terceiro_valor : 0, terceiro_parcela: U.reais(p.t), terceiro_recebido: cp.terceiro_recebido === 1,
          divisao: cp.divisao, divisao_rotulo: rotuloDivisao(cp.divisao, car.titular), primeira_fatura: cp.primeira_fatura, obs: cp.obs || '', criado_por: cp.criado_por });
      });
    });
    recs('CARTAO').forEach(function (rc) {
      if (rc.cartao_id !== cartaoId || !recNoMes(rc, mes) || (restrito && rc.divisao === 'INDIVIDUAL')) return; var c = U.centavos(rc.valor);
      total += c; if (rc.divisao !== 'INDIVIDUAL') comp += c; receber += parteDoOutro(c, rc.divisao);
      itens.push({ id: rc.id, recorrente: true, data_compra: dataRec(rc, mes), descricao: rc.descricao, categoria: rc.categoria || '', parcela: 1, parcelas: 1, valor: U.reais(c), valor_total: rc.valor,
        divisao: rc.divisao, divisao_rotulo: rotuloDivisao(rc.divisao, car.titular), obs: rc.obs || '', criado_por: rc.criado_por, fim: rc.fim || '' });
    });
    itens.sort(function (a, b) { return String(a.data_compra).localeCompare(String(b.data_compra)) || a.descricao.localeCompare(b.descricao, 'pt-BR'); });
    var st = statusFatura(cartaoId, mes), proximas = [];
    for (var i = 1; i <= 6; i++) proximas.push({ mes: U.somarMeses(mes, i), rotulo: U.rotuloMes(U.somarMeses(mes, i)), total: 0 });
    D.todos('compras').forEach(function (cp) {
      if (cp.cartao_id !== cartaoId || (restrito && cp.divisao === 'INDIVIDUAL')) return;
      parcelas(cp).forEach(function (p) { var d = U.difMeses(mes, p.mes); if (d >= 1 && d <= 6) proximas[d - 1].total += p.c; });
    });
    recs('CARTAO').forEach(function (rc) { if (rc.cartao_id === cartaoId && !(restrito && rc.divisao === 'INDIVIDUAL')) proximas.forEach(function (x) { if (recNoMes(rc, x.mes)) x.total += U.centavos(rc.valor); }); });
    proximas.forEach(function (x) { x.total = U.reais(x.total); });
    var ven = Math.min(Number(car.dia_vencimento) || 1, diasNoMes(mes));
    return { cartao: limpo_(car), cartao_nome: nomeCartao(car), titular_nome: P.nomeDe(car.titular), mes: mes, rotulo: U.rotuloMes(mes), vencimento: mes + '-' + U.pad(ven),
      itens: itens, total: U.reais(total), compartilhado: U.reais(comp), receber: U.reais(receber), terceiros: U.reais(terc),
      paga: !!(st && st.paga === 1), paga_em: st && st.paga === 1 ? st.paga_em : null, paga_por: st && st.paga === 1 ? st.paga_por : null, proximas: proximas,
      restrito: restrito }; // restrito: cartão do outro — só as compras divididas (o total é só delas)
  }
  /** Total de cada cartão na fatura do mês (para a lista e o resumo). */
  function faturasDoMes(mes, ve) {
    var tot = {}, cartoes = D.mapa('cartoes'), ok = function (cartaoId, div) { var car = cartoes[cartaoId]; return car && visivel(car.titular, div, ve); };
    D.todos('compras').forEach(function (cp) { if (!ok(cp.cartao_id, cp.divisao)) return; parcelas(cp).forEach(function (p) { if (p.mes === mes) { var t = tot[cp.cartao_id] = tot[cp.cartao_id] || { total: 0, n: 0 }; t.total += p.c; t.n++; } }); });
    recs('CARTAO').forEach(function (rc) { if (ok(rc.cartao_id, rc.divisao) && recNoMes(rc, mes)) { var t = tot[rc.cartao_id] = tot[rc.cartao_id] || { total: 0, n: 0 }; t.total += U.centavos(rc.valor); t.n++; } });
    return D.todos('cartoes').filter(function (c) { return c.ativo === 1 || tot[c.id]; }).map(function (c) {
      var st = statusFatura(c.id, mes), t = tot[c.id] || { total: 0, n: 0 };
      var restrito = !!ve && c.titular !== ve;
      return { id: c.id, nome: nomeCartao(c), titular: c.titular, titular_nome: P.nomeDe(c.titular), ativo: c.ativo, total: U.reais(t.total), lancamentos: t.n, paga: restrito ? false : !!(st && st.paga === 1), restrito: restrito,
        vencimento: mes + '-' + U.pad(Math.min(Number(c.dia_vencimento) || 1, diasNoMes(mes))) };
    }).sort(function (a, b) { return a.titular_nome.localeCompare(b.titular_nome, 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR'); });
  }
  /** Compras parceladas que ainda têm parcelas a partir do mês informado. */
  function parcelamentos(mes, cartaoId, ve) {
    var cartoes = D.mapa('cartoes');
    return D.todos('compras').filter(function (cp) { return Number(cp.parcelas) > 1 && ultimaFatura(cp) >= mes && (!cartaoId || cp.cartao_id === cartaoId) && cartoes[cp.cartao_id] && visivel(cartoes[cp.cartao_id].titular, cp.divisao, ve); }).map(function (cp) {
      var ps = parcelas(cp), rest = ps.filter(function (p) { return p.mes >= mes; }), car = cartoes[cp.cartao_id], atual = ps.filter(function (p) { return p.mes === mes; })[0];
      return { id: cp.id, cartao_id: cp.cartao_id, cartao: nomeCartao(car), titular: car.titular, titular_nome: P.nomeDe(car.titular), descricao: cp.descricao, data_compra: cp.data_compra,
        valor_total: cp.valor_total, parcelas: ps.length, parcela_atual: atual ? atual.n : null, valor_parcela: U.reais(ps[ps.length - 1].c), restantes: rest.length,
        valor_restante: U.reais(rest.reduce(function (s, p) { return s + p.c; }, 0)), ultima_fatura: ultimaFatura(cp), ultima_rotulo: U.rotuloMes(ultimaFatura(cp)), divisao: cp.divisao, divisao_rotulo: rotuloDivisao(cp.divisao, car.titular) };
    }).sort(function (a, b) { return a.ultima_fatura.localeCompare(b.ultima_fatura) || a.descricao.localeCompare(b.descricao, 'pt-BR'); });
  }
  /** Comprometimento das próximas faturas, por pessoa (soma de todos os cartões de cada um). */
  function projecao(mes, nMeses, ve) {
    var cartoes = D.mapa('cartoes'), us = P.ativos(), meses = [];
    for (var i = 0; i < nMeses; i++) meses.push(U.somarMeses(mes, i));
    if (ve) us = us.filter(function (u) { return u.email === ve; }); // privacidade: só as suas faturas
    var tab = {}; us.forEach(function (u) { tab[u.email] = meses.map(function () { return 0; }); });
    D.todos('compras').forEach(function (cp) {
      var car = cartoes[cp.cartao_id]; if (!car || !tab[car.titular]) return;
      parcelas(cp).forEach(function (p) { var d = U.difMeses(mes, p.mes); if (d >= 0 && d < nMeses) tab[car.titular][d] += p.c; });
    });
    recs('CARTAO').forEach(function (rc) { var car = cartoes[rc.cartao_id]; if (!car || !tab[car.titular]) return; meses.forEach(function (m, d) { if (recNoMes(rc, m)) tab[car.titular][d] += U.centavos(rc.valor); }); });
    return { meses: meses.map(function (m) { return { mes: m, rotulo: U.rotuloMes(m) }; }), pessoas: us.map(function (u) { return { email: u.email, nome: u.nome, valores: tab[u.email].map(U.reais) }; }) };
  }

  // ---------- validação ----------
  function divisaoValida(d) { if (DIVISOES.indexOf(d) < 0) throw erro_(400, 'Escolha como o valor é dividido.'); return d; }
  function validarCartao(b, atual) {
    var v = {
      nome: U.texto(b.nome !== undefined ? b.nome : atual && atual.nome, 40),
      final: String(b.final !== undefined ? b.final : (atual && atual.final) || '').replace(/\D/g, '').slice(-4),
      dia_fechamento: parseInt(b.dia_fechamento !== undefined ? b.dia_fechamento : atual && atual.dia_fechamento, 10),
      dia_vencimento: parseInt(b.dia_vencimento !== undefined ? b.dia_vencimento : atual && atual.dia_vencimento, 10),
      ativo: b.ativo !== undefined ? (b.ativo === true || b.ativo === 1 || b.ativo === '1' ? 1 : 0) : (atual ? atual.ativo : 1)
    };
    if (v.nome.length < 2) throw erro_(400, 'Informe o nome do cartão (ex.: Nubank, Itaú Platinum).');
    if (!(v.dia_fechamento >= 1 && v.dia_fechamento <= 31)) throw erro_(400, 'Dia de fechamento inválido (1 a 31).');
    if (!(v.dia_vencimento >= 1 && v.dia_vencimento <= 31)) throw erro_(400, 'Dia de vencimento inválido (1 a 31).');
    return v;
  }
  function validarCompra(b, atual, perfil) {
    var cartaoId = b.cartao_id !== undefined ? b.cartao_id : atual && atual.cartao_id, car = D.porId('cartoes', cartaoId);
    if (!car) throw erro_(400, 'Escolha o cartão.');
    if (car.titular !== perfil.email) throw erro_(403, 'Só o titular do cartão lança compras nele.');
    if (car.ativo !== 1 && (!atual || atual.cartao_id !== car.id)) throw erro_(400, 'Este cartão está desativado.');
    var v = { cartao_id: car.id, descricao: U.texto(b.descricao, 120), categoria: U.texto(b.categoria, 40), obs: U.texto(b.obs, 300), data_compra: String(b.data_compra || ''),
      parcelas: parseInt(b.parcelas, 10), divisao: divisaoValida(b.divisao) };
    if (v.descricao.length < 2) throw erro_(400, 'Descreva a compra.');
    if (!U.dataValida(v.data_compra)) throw erro_(400, 'Data da compra inválida.');
    var c = U.centavos(b.valor_total); if (isNaN(c) || c === 0 || Math.abs(c) > 1e10) throw erro_(400, 'Informe o valor total da compra.');
    v.valor_total = U.reais(c);
    if (!(v.parcelas >= 1 && v.parcelas <= MAX_PARCELAS)) throw erro_(400, 'Número de parcelas inválido (1 a ' + MAX_PARCELAS + ').');
    var pf = mesDe(b.primeira_fatura); v.primeira_fatura = U.mesValido(pf) ? pf : faturaSugerida(car, v.data_compra);
    var dif = U.difMeses(v.data_compra.slice(0, 7), v.primeira_fatura);
    if (dif > 3) throw erro_(400, 'A 1ª parcela ficaria na fatura de ' + U.rotuloMes(v.primeira_fatura) + ', mais de 3 meses depois da compra. Confira a data.');
    if (dif < -1) throw erro_(400, 'A 1ª parcela ficaria na fatura de ' + U.rotuloMes(v.primeira_fatura) + ', antes da data da compra (' + v.data_compra.split('-').reverse().join('/') + '). Confira a data ou a parcela atual.');
    var t = validarTerceiro(b, atual, c); Object.keys(t).forEach(function (k) { v[k] = t[k]; });
    return v;
  }
  /** Terceiro (alguém de fora do casal) que paga parte da compra: nome + valor total que ele paga. */
  function validarTerceiro(b, atual, totalC) {
    var g = function (k) { return b[k] !== undefined ? b[k] : (atual ? atual[k] : undefined); };
    var nome = U.texto(g('terceiro'), 60);
    if (!nome) return { terceiro: '', terceiro_valor: 0, terceiro_recebido: 0 };
    if (nome.length < 2) throw erro_(400, 'Informe o nome de quem vai pagar parte da compra.');
    var t = U.centavos(g('terceiro_valor')); if (isNaN(t) || t <= 0) throw erro_(400, 'Informe quanto ' + nome + ' vai pagar.');
    if (totalC <= 0) throw erro_(400, 'Estorno não pode ter terceiro.');
    if (t > totalC) throw erro_(400, nome + ' não pode pagar mais que o valor da compra (' + U.reais(totalC).toFixed(2).replace('.', ',') + ').');
    var rec = b.terceiro_recebido !== undefined ? (b.terceiro_recebido === true || b.terceiro_recebido === 1 ? 1 : 0) : (atual && atual.terceiro_recebido === 1 ? 1 : 0);
    return { terceiro: nome, terceiro_valor: U.reais(t), terceiro_recebido: rec };
  }
  /**
   * Lote de itens lançados de uma vez numa fatura (como aparecem no extrato do cartão).
   * Cada item: { data_compra, descricao, categoria, valor_parcela, parcela_atual, parcelas, divisao }.
   * valor_total = valor_parcela × parcelas; a 1ª fatura = fatura do lote − (parcela_atual − 1).
   */
  function validarLote(b, perfil) {
    var fatura = mesDe(b.fatura); if (!U.mesValido(fatura)) throw erro_(400, 'Escolha a fatura.');
    var itens = Array.isArray(b.itens) ? b.itens : []; if (!itens.length) throw erro_(400, 'Preencha pelo menos um item.');
    if (itens.length > 100) throw erro_(400, 'Limite de 100 itens por vez.');
    return itens.map(function (it, i) {
      try {
        var n = parseInt(it.parcelas, 10) || 1, k = parseInt(it.parcela_atual, 10) || 1, vp = U.centavos(it.valor_parcela);
        if (isNaN(vp) || vp === 0) throw erro_(400, 'informe o valor da parcela.');
        if (!(n >= 1 && n <= MAX_PARCELAS)) throw erro_(400, 'número de parcelas inválido (1 a ' + MAX_PARCELAS + ').');
        if (!(k >= 1 && k <= n)) throw erro_(400, 'a parcela atual deve estar entre 1 e ' + n + '.');
        return validarCompra({ cartao_id: b.cartao_id, descricao: it.descricao, categoria: it.categoria, obs: it.obs, data_compra: it.data_compra, parcelas: n,
          divisao: it.divisao, valor_total: U.reais(vp * n), primeira_fatura: U.somarMeses(fatura, -(k - 1)) }, null, perfil);
      } catch (e) { throw erro_(e.status || 400, 'Linha ' + (i + 1) + (it.descricao ? ' (' + U.texto(it.descricao, 40) + ')' : '') + ': ' + e.message.charAt(0).toLowerCase() + e.message.slice(1)); }
    });
  }
  /** Gasto fixo: b traz os campos novos; "atual" (na edição) completa o que não veio. */
  function validarRecorrente(b, atual, perfil) {
    var g = function (k) { return b[k] !== undefined ? b[k] : (atual ? atual[k] : undefined); };
    var v = { tipo: String(g('tipo') || ''), descricao: U.texto(g('descricao'), 120), categoria: U.texto(g('categoria'), 40), obs: U.texto(g('obs'), 300),
      dia: parseInt(g('dia'), 10), divisao: divisaoValida(g('divisao')), inicio: mesDe(g('inicio')), fim: mesDe(g('fim') || '') };
    if (v.tipo !== 'CARTAO' && v.tipo !== 'PIX') throw erro_(400, 'Escolha se o gasto fixo é no cartão ou no pix/débito.');
    if (v.descricao.length < 2) throw erro_(400, 'Descreva o gasto fixo (ex.: Netflix, Aluguel).');
    var c = U.centavos(g('valor')); if (isNaN(c) || c <= 0 || c > 1e10) throw erro_(400, 'Informe o valor mensal.'); v.valor = U.reais(c);
    if (!(v.dia >= 1 && v.dia <= 31)) throw erro_(400, 'Dia do mês inválido (1 a 31).');
    if (!U.mesValido(v.inicio)) throw erro_(400, 'Informe o mês em que o gasto fixo começa.');
    if (v.fim && !U.mesValido(v.fim)) v.fim = '';
    if (v.fim && v.fim < v.inicio) throw erro_(400, 'O último mês não pode ser antes do primeiro.');
    if (v.tipo === 'CARTAO') {
      var car = D.porId('cartoes', g('cartao_id')); if (!car) throw erro_(400, 'Escolha o cartão.');
      if (car.titular !== perfil.email) throw erro_(403, 'Só o titular do cartão cadastra gastos fixos nele.');
      if (car.ativo !== 1 && (!atual || atual.cartao_id !== car.id)) throw erro_(400, 'Este cartão está desativado.');
      v.cartao_id = car.id; v.forma = '';
    } else {
      v.forma = String(g('forma') || ''); if (FORMAS.indexOf(v.forma) < 0) throw erro_(400, 'Escolha a forma de pagamento (pix, débito ou dinheiro).'); v.cartao_id = '';
    }
    v.dono = perfil.email;
    return v;
  }
  function validarGasto(b) {
    var v = { data: String(b.data || ''), descricao: U.texto(b.descricao, 120), categoria: U.texto(b.categoria, 40), obs: U.texto(b.obs, 300), forma: String(b.forma || ''), divisao: divisaoValida(b.divisao) };
    if (!U.dataValida(v.data)) throw erro_(400, 'Data inválida.');
    if (v.descricao.length < 2) throw erro_(400, 'Descreva o gasto.');
    if (FORMAS.indexOf(v.forma) < 0) throw erro_(400, 'Escolha a forma de pagamento (pix, débito ou dinheiro).');
    var c = U.centavos(b.valor); if (isNaN(c) || c <= 0 || c > 1e10) throw erro_(400, 'Informe o valor.');
    v.valor = U.reais(c); return v;
  }
  function categorias() {
    var vistas = {}; CATEGORIAS_PADRAO.forEach(function (c) { vistas[c] = 1; });
    D.todos('compras').concat(D.todos('gastos'), D.todos('recorrentes')).forEach(function (x) { if (x.categoria) vistas[x.categoria] = 1; });
    return Object.keys(vistas).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  }

  return { DIVISOES: DIVISOES, FORMAS: FORMAS, faturaSugerida: faturaSugerida, parcelas: parcelas, ultimaFatura: ultimaFatura, parteDoOutro: parteDoOutro, rotuloDivisao: rotuloDivisao, efetivo: efetivo, terceiroDe: terceiroDe, validarTerceiro: validarTerceiro,
    acerto: acerto, acertoComIndice: acertoComIndice, historicoAcertos: historicoAcertos, faturaDetalhe: faturaDetalhe, faturasDoMes: faturasDoMes, parcelamentos: parcelamentos, projecao: projecao, nomeCartao: nomeCartao,
    validarCartao: validarCartao, visivel: visivel, minhaParte: minhaParte, validarCompra: validarCompra, validarLote: validarLote, validarRecorrente: validarRecorrente, recNoMes: recNoMes, mesesRec: mesesRec, gastosFixosDoMes: gastosFixosDoMes, validarGasto: validarGasto, categorias: categorias, indice: indice };
})();
