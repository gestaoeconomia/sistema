/**
 * V1.2 (do SIG — "Qualidade dos dados"): Conferência dos dados.
 * Procura nos SEUS lançamentos o que costuma ser erro de digitação ou esquecimento. Nada é alterado sozinho: cada item leva
 * à tela onde se corrige. "Não é erro" esconde um item (fica guardado por pessoa em CONFIG, chave conf_ok:<e-mail>).
 * Privacidade: só olha o que é seu (seus cartões, seus pix/débito, seus gastos fixos) — o outro não aparece aqui.
 */
var QC = (function () {
  var MAX_POR_GRUPO = 60;
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function somarDias(iso, n) { var d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function brl(v) { var n = Number(v) || 0, s = Math.abs(n).toFixed(2).split('.'); return (n < 0 ? '−' : '') + 'R$ ' + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + s[1]; }
  function dmy(iso) { return String(iso || '').split('-').reverse().join('/'); }
  function ignorados(email) { try { return JSON.parse(D.config('conf_ok:' + email, '[]')) || []; } catch (e) { return []; } }

  function conferir(email, hojeOpc) {
    var hoje = hojeOpc || D.hojeISO(), ok = {}, grupos = [], ign = ignorados(email);
    ign.forEach(function (k) { ok[k] = 1; });
    var cartoes = D.mapa('cartoes'), meus = {}; D.todos('cartoes').forEach(function (c) { if (c.titular === email) meus[c.id] = c; });
    var compras = D.todos('compras').filter(function (c) { return meus[c.cartao_id]; });
    var gastos = D.todos('gastos').filter(function (g) { return g.pago_por === email; });
    var fixos = D.todos('recorrentes').filter(function (r) { return r.dono === email; });
    var limite12 = U.somarMeses(hoje.slice(0, 7), -12);
    function grupo(chave, titulo, explica, itens) {
      var lista = itens.filter(function (x) { return !ok[x.chave]; });
      if (lista.length) grupos.push({ chave: chave, titulo: titulo, explica: explica, total: lista.length, itens: lista.slice(0, MAX_POR_GRUPO) });
    }
    var linkCompra = function (c) { return { rota: 'faturas', query: { cartao: c.cartao_id, mes: String(c.primeira_fatura).slice(0, 7) } }; };
    var linkGasto = function (g) { return { rota: 'gastos', query: { mes: String(g.data).slice(0, 7) } }; };
    function item(chave, titulo, texto, link, ignoravel) { return { chave: chave, titulo: titulo, texto: texto, rota: link.rota, query: link.query, ignoravel: !!ignoravel }; }

    // 1) lançamentos repetidos: mesmo dia, mesmo valor e mesma descrição (no mesmo cartão / no pix-débito)
    var rep = [], vistos = {};
    compras.forEach(function (c) { var k = 'c|' + c.cartao_id + '|' + c.data_compra + '|' + U.centavos(c.valor_total) + '|' + norm(c.descricao); (vistos[k] = vistos[k] || []).push(c); });
    gastos.forEach(function (g) { var k = 'g|' + g.data + '|' + U.centavos(g.valor) + '|' + norm(g.descricao); (vistos[k] = vistos[k] || []).push(g); });
    Object.keys(vistos).forEach(function (k) {
      var l = vistos[k]; if (l.length < 2) return; var x = l[0], ehCompra = k.charAt(0) === 'c';
      rep.push(item('rep|' + l.map(function (y) { return y.id; }).sort().join(','), x.descricao + ' — ' + l.length + ' vezes',
        dmy(ehCompra ? x.data_compra : x.data) + ' · ' + brl(ehCompra ? x.valor_total : x.valor) + ' · ' + (ehCompra ? R.nomeCartao(cartoes[x.cartao_id]) : ({ PIX: 'Pix', DEBITO: 'Débito', DINHEIRO: 'Dinheiro' }[x.forma] || x.forma)) + ' · ' + l.map(function (y) { return y.id; }).join(', '),
        ehCompra ? linkCompra(x) : linkGasto(x), true));
    });
    grupo('repetidos', 'Lançamentos que parecem repetidos', 'Mesmo dia, mesmo valor e mesma descrição. Se foram duas compras de verdade, marque “Não é erro”.', rep);

    // 2) data fora do esperado: compra no futuro, pix/débito mais de 31 dias à frente (ano trocado?), datas antes de 2010
    var dt = [];
    compras.forEach(function (c) { if (c.data_compra > somarDias(hoje, 1) || c.data_compra < '2010-01-01') dt.push(item('dt|' + c.id, c.descricao, 'Compra em ' + dmy(c.data_compra) + (c.data_compra > hoje ? ' (no futuro)' : ' (ano muito antigo)') + ' · ' + brl(c.valor_total), linkCompra(c), true)); });
    gastos.forEach(function (g) { if (g.data > somarDias(hoje, 31) || g.data < '2010-01-01') dt.push(item('dt|' + g.id, g.descricao, 'Lançado em ' + dmy(g.data) + (g.data > hoje ? ' (mais de um mês à frente)' : ' (ano muito antigo)') + ' · ' + brl(g.valor), linkGasto(g), true)); });
    grupo('datas', 'Datas fora do esperado', 'Quase sempre é o ano digitado errado (ex.: 2062 em vez de 2026).', dt);

    // 3) sem categoria (últimos 12 meses): somem do “onde foi o dinheiro” e dos limites
    var sc = [];
    compras.forEach(function (c) { if (!c.categoria && R.ultimaFatura(c) >= limite12) sc.push(item('cat|' + c.id, c.descricao, 'Compra de ' + dmy(c.data_compra) + ' · ' + brl(c.valor_total), linkCompra(c))); });
    gastos.forEach(function (g) { if (!g.categoria && String(g.data).slice(0, 7) >= limite12) sc.push(item('cat|' + g.id, g.descricao, 'Pix/débito de ' + dmy(g.data) + ' · ' + brl(g.valor), linkGasto(g))); });
    fixos.forEach(function (r) { if (!r.categoria && (!r.fim || r.fim >= limite12)) sc.push(item('cat|' + r.id, r.descricao, 'Gasto fixo · ' + brl(r.valor) + ' por mês', { rota: 'fixos', query: {} })); });
    grupo('sem_categoria', 'Sem categoria', 'Sem categoria, o gasto não entra em “onde foi o dinheiro” nem nos limites por categoria.', sc);

    // 4) categorias escritas de jeitos diferentes ("Mercado", "mercado", "Mércado")
    var cats = {}; compras.concat(gastos, fixos).forEach(function (x) { if (!x.categoria) return; var k = norm(x.categoria).replace(/s$/, ''); (cats[k] = cats[k] || {})[x.categoria] = ((cats[k] || {})[x.categoria] || 0) + 1; });
    var cv = []; Object.keys(cats).forEach(function (k) { var nomes = Object.keys(cats[k]); if (nomes.length < 2) return;
      nomes.sort(function (a, b) { return cats[k][b] - cats[k][a]; });
      cv.push(item('catv|' + k, nomes.map(function (n) { return '“' + n + '”'; }).join(' · '), 'Contam como categorias diferentes nos totais e nos limites. A mais usada é “' + nomes[0] + '” (' + cats[k][nomes[0]] + ' lançamentos).', { rota: 'gastos', query: {} }, true)); });
    grupo('categorias', 'Mesma categoria escrita de jeitos diferentes', 'Padronize a escrita ao editar os lançamentos.', cv);

    // 5) gastos fixos ainda ativos num cartão desativado
    var fd = [];
    fixos.forEach(function (r) { if (r.tipo !== 'CARTAO') return; var car = cartoes[r.cartao_id]; if (car && car.ativo !== 1 && (!r.fim || r.fim >= hoje.slice(0, 7))) fd.push(item('fd|' + r.id, r.descricao, 'Continua entrando todo mês no cartão desativado ' + R.nomeCartao(car) + '. Encerre ou mude de cartão.', { rota: 'fixos', query: {} })); });
    grupo('fixo_cartao_off', 'Gastos fixos em cartão desativado', 'O cartão foi desativado, mas o gasto fixo dele continua sendo contado.', fd);

    // 6) faturas que já venceram (até 6 meses) e não foram marcadas como pagas
    var fp = [];
    for (var i = 1; i <= 6; i++) {
      var m = U.somarMeses(hoje.slice(0, 7), -i + 1);
      R.faturasDoMes(m, email).forEach(function (f) {
        if (f.titular !== email || f.paga || !(f.total > 0) || f.vencimento >= somarDias(hoje, -5)) return;
        fp.push(item('fp|' + f.id + '|' + m, 'Fatura ' + f.nome + ' — ' + U.rotuloMes(m), 'Venceu em ' + dmy(f.vencimento) + ' · ' + brl(f.total) + '. Se já pagou, marque como paga.', { rota: 'faturas', query: { cartao: f.id, mes: m } }, true));
      });
    }
    grupo('faturas_abertas', 'Faturas vencidas sem “paga”', 'Os lembretes continuam avisando dessas faturas até serem marcadas.', fp);

    // 7) terceiros que ainda não pagaram, com compra de mais de 60 dias
    var tp = [];
    compras.forEach(function (c) { if (R.terceiroDe(c) > 0 && c.terceiro_recebido !== 1 && c.data_compra < somarDias(hoje, -60)) tp.push(item('tp|' + c.id, c.terceiro + ' — ' + c.descricao, brl(c.terceiro_valor) + ' a receber · compra de ' + dmy(c.data_compra), linkCompra(c), true)); });
    grupo('terceiros', 'Terceiros que ainda não pagaram (mais de 60 dias)', 'Se já recebeu, marque como recebido em Cartões e faturas ▸ Terceiros.', tp);

    return { grupos: grupos, total: grupos.reduce(function (s, g) { return s + g.total; }, 0), ignorados: ign.length, hoje: hoje };
  }
  /** "Não é erro" (ou desfazer todos). */
  function marcarOk(email, chave, limpar) {
    var l = limpar ? [] : ignorados(email);
    if (!limpar) { chave = String(chave || '').slice(0, 400); if (!chave) throw erro_(400, 'Item inválido.'); if (l.indexOf(chave) < 0) l.push(chave); if (l.length > 500) l = l.slice(-500); }
    D.definirConfig('conf_ok:' + email, JSON.stringify(l));
    D.auditar(email, limpar ? 'Voltou a mostrar os itens marcados como “não é erro”' : 'Marcou item da conferência como “não é erro”', 'config', 'conf_ok:' + email, limpar ? null : { item: chave });
    return { ok: true, ignorados: l.length };
  }
  return { conferir: conferir, marcarOk: marcarOk };
})();

rota_('GET', '/api/conferencia', {}, function (c) { return QC.conferir(c.perfil.email); });
rota_('POST', '/api/conferencia/ok', {}, function (c) { return QC.marcarOk(c.perfil.email, c.body.chave, c.body.limpar === true); });
