/**
 * V1.3 — Novidades do(a) parceiro(a): quando alguém lança, altera ou exclui uma compra no cartão ou um pix/débito que
 * entra no acerto (DIVIDIDO ou "todo do outro"), o outro recebe uma notificação no sino do app.
 *  • Lançamentos "Só meu" não geram nada (continuam privados).
 *  • Lançar vários de uma vez (lote do cartão, extrato importado) gera UMA notificação com o resumo.
 *  • Fica na aba NOTIFICACOES (criada sozinha na primeira notificação). "lida_em" vazio = ainda não vista.
 */
var NT = (function () {
  var FORMAS = { PIX: 'pix', DEBITO: 'débito', DINHEIRO: 'dinheiro' };
  function brl(c) { var n = U.reais(c), s = Math.abs(n).toFixed(2).split('.'); return (n < 0 ? '−' : '') + 'R$ ' + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + s[1]; }
  function compartilhada(div) { return div === 'DIVIDIDO' || div === 'OUTRO'; }
  function apelido(email) { return P.primeiroNome(P.nomeDe(email)); }
  function criar(de, tipo, titulo, texto, rota, query, ref) {
    var par = P.parceiroDe(de); if (!par) return null;   // ainda não há outra pessoa
    var o = { id: D.proximoId('NOT', 6), para: par.email, de: de, tipo: tipo, titulo: U.texto(titulo, 160), texto: U.texto(texto, 400), rota: rota || '', query: JSON.stringify(query || {}), ref: ref || '', criado_em: D.agoraISO(), lida_em: '' };
    D.inserir('notificacoes', o); return o;
  }
  /** Parte do outro numa compra/gasto (centavos), já sem o que um terceiro paga. */
  function parteOutro(totalC, terceiroC, div) { return R.parteDoOutro(totalC - (terceiroC || 0), div); }
  function fraseParte(parte, div, parcelas) {
    if (!parte) return '';
    var p = parcelas > 1 ? Math.round(parte / parcelas) : parte;
    return (div === 'OUTRO' ? 'todo seu' : 'dividido') + ' · sua parte ' + brl(p) + (parcelas > 1 ? ' por mês (' + parcelas + 'x)' : '');
  }
  function descCompra(cp) {
    var car = D.porId('cartoes', cp.cartao_id), total = U.centavos(cp.valor_total), n = Number(cp.parcelas) || 1;
    return { car: car, total: total, n: n, onde: car ? R.nomeCartao(car) : 'cartão', valor: n > 1 ? n + 'x de ' + brl(Math.round(total / n)) : brl(total),
      parte: parteOutro(total, R.terceiroDe(cp), cp.divisao) };
  }
  /** acao: 'novo' | 'alterou' | 'excluiu' | 'divisao'. "antes" = registro anterior (alteração/exclusão). */
  function compra(perfil, acao, cp, antes) {
    var agora = cp && compartilhada(cp.divisao), antiga = antes && compartilhada(antes.divisao);
    if (!agora && !antiga) return null;
    var x = descCompra(cp || antes), quem = apelido(perfil.email), alvo = cp || antes;
    var link = { cartao: alvo.cartao_id, mes: String(alvo.primeira_fatura).slice(0, 7) }, titulo, texto;
    if (acao === 'excluiu') { titulo = quem + ' excluiu uma compra dividida'; texto = alvo.descricao + ' · ' + x.valor + ' no ' + x.onde + ' — saiu do acerto.'; }
    else if (!agora) { titulo = quem + ' tirou uma compra da divisão'; texto = alvo.descricao + ' · ' + x.valor + ' no ' + x.onde + ' agora é só de ' + quem + ' — saiu do acerto.'; }
    else if (acao === 'novo') { titulo = quem + ' lançou uma compra ' + (cp.divisao === 'OUTRO' ? 'para você' : 'dividida'); texto = cp.descricao + ' · ' + x.valor + ' no ' + x.onde + ' · ' + fraseParte(x.parte, cp.divisao, x.n) + '.'; }
    else if (!antiga) { titulo = quem + ' passou a dividir uma compra'; texto = cp.descricao + ' · ' + x.valor + ' no ' + x.onde + ' · ' + fraseParte(x.parte, cp.divisao, x.n) + '.'; }
    else { titulo = quem + ' alterou uma compra dividida'; texto = cp.descricao + ' · ' + x.valor + ' no ' + x.onde + ' · ' + fraseParte(x.parte, cp.divisao, x.n) + mudancas(antes, cp, ['descricao', 'valor_total', 'parcelas', 'data_compra', 'divisao']) + '.'; }
    return criar(perfil.email, 'compra', titulo, texto, acao === 'excluiu' ? 'acerto' : 'faturas', acao === 'excluiu' ? { mes: link.mes } : link, alvo.id);
  }
  function gasto(perfil, acao, g, antes) {
    var agora = g && compartilhada(g.divisao), antiga = antes && compartilhada(antes.divisao);
    if (!agora && !antiga) return null;
    var alvo = g || antes, quem = apelido(perfil.email), total = U.centavos(alvo.valor), forma = FORMAS[alvo.forma] || alvo.forma, mes = String(alvo.data).slice(0, 7), titulo, texto;
    var base = alvo.descricao + ' · ' + brl(total) + ' no ' + forma + ' em ' + String(alvo.data).split('-').reverse().slice(0, 2).join('/');
    if (acao === 'excluiu') { titulo = quem + ' excluiu um gasto dividido'; texto = base + ' — saiu do acerto.'; }
    else if (!agora) { titulo = quem + ' tirou um gasto da divisão'; texto = base + ' agora é só de ' + quem + ' — saiu do acerto.'; }
    else if (acao === 'novo') { titulo = quem + ' lançou um gasto ' + (g.divisao === 'OUTRO' ? 'para você' : 'dividido'); texto = base + ' · ' + fraseParte(parteOutro(total, 0, g.divisao), g.divisao, 1) + '.'; }
    else if (!antiga) { titulo = quem + ' passou a dividir um gasto'; texto = base + ' · ' + fraseParte(parteOutro(total, 0, g.divisao), g.divisao, 1) + '.'; }
    else { titulo = quem + ' alterou um gasto dividido'; texto = base + ' · ' + fraseParte(parteOutro(total, 0, g.divisao), g.divisao, 1) + mudancas(antes, g, ['descricao', 'valor', 'data', 'divisao', 'forma']) + '.'; }
    return criar(perfil.email, 'gasto', titulo, texto, acao === 'excluiu' ? 'acerto' : 'gastos', { mes: mes }, alvo.id);
  }
  var ROT = { descricao: 'descrição', valor_total: 'valor', valor: 'valor', parcelas: 'parcelas', data_compra: 'data', data: 'data', divisao: 'divisão', forma: 'forma' };
  function mudancas(a, b, campos) {
    var m = campos.filter(function (k) { return String(a[k] == null ? '' : a[k]) !== String(b[k] == null ? '' : b[k]); }).map(function (k) { return ROT[k]; });
    m = m.filter(function (x, i) { return m.indexOf(x) === i; });
    return m.length ? ' (mudou: ' + m.join(', ') + ')' : '';
  }
  /** Vários lançamentos de uma vez (lote do cartão ou extrato importado): uma notificação só, com o resumo. */
  function lote(perfil, tipo, itens, extra, mesFatura) {
    var div = itens.filter(function (v) { return compartilhada(v.divisao); }); if (!div.length) return null;
    var quem = apelido(perfil.email), parte = 0;
    div.forEach(function (v) { var t = U.centavos(tipo === 'compra' ? v.valor_total : v.valor), n = tipo === 'compra' ? (Number(v.parcelas) || 1) : 1; parte += Math.round(parteOutro(t, tipo === 'compra' ? R.terceiroDe(v) : 0, v.divisao) / n); });
    var nomes = div.slice(0, 3).map(function (v) { return v.descricao; }).join(', ') + (div.length > 3 ? ' e mais ' + (div.length - 3) : '');
    var titulo = quem + ' lançou ' + div.length + (tipo === 'compra' ? (div.length === 1 ? ' compra dividida' : ' compras divididas') : (div.length === 1 ? ' gasto dividido' : ' gastos divididos'));
    var texto = nomes + (extra ? ' · ' + extra : '') + ' · sua parte ' + brl(parte) + (tipo === 'compra' ? ' na fatura' : '') + '.';
    var q = tipo === 'compra' ? { cartao: div[0].cartao_id, mes: String(div[0].primeira_fatura).slice(0, 7) } : { mes: String(div[0].data).slice(0, 7) };
    if (tipo === 'compra' && U.mesValido(String(mesFatura || ''))) q.mes = mesFatura;
    return criar(perfil.email, tipo, titulo, texto, tipo === 'compra' ? 'faturas' : 'gastos', q, div.map(function (v) { return v.id; }).join(',').slice(0, 300));
  }
  /** Notificações de quem está vendo (as mais novas primeiro; no mesmo instante, a de número maior). */
  function listar(email, limite) {
    return D.todos('notificacoes').filter(function (n) { return n.para === email; }).sort(function (a, b) { return ORD_TXT_(String(b.criado_em), String(a.criado_em)) || ORD_TXT_(String(b.id), String(a.id)); }).slice(0, limite || 30).map(function (n) {
      var q = {}; try { q = JSON.parse(n.query || '{}') || {}; } catch (e) { q = {}; }
      return { id: n.id, de: n.de, de_nome: P.nomeDe(n.de), tipo: n.tipo, titulo: n.titulo, texto: n.texto, rota: n.rota, query: q, criado_em: n.criado_em, lida: !!n.lida_em };
    });
  }
  function naoLidas(email) { return D.todos('notificacoes').filter(function (n) { return n.para === email && !n.lida_em; }).length; }
  /** Marca como vistas as notificações de quem chama (todas, ou só as dos ids). */
  function marcarLidas(email, ids) {
    var set = Array.isArray(ids) ? ids.reduce(function (o, k) { o[k] = 1; return o; }, {}) : null, agora = D.agoraISO(), n = 0;
    var alt = D.todos('notificacoes').filter(function (x) { return x.para === email && !x.lida_em && (!set || set[x.id]); }).slice(0, 200).map(function (x) {
      var o = {}; Object.keys(x).forEach(function (k) { o[k] = x[k]; }); o.lida_em = agora; n++; return o;
    });
    D.atualizarVarios('notificacoes', alt);   // V1.4 (do SIG): uma localização e linhas vizinhas num só bloco, em vez de uma gravação por aviso
    return { ok: true, marcadas: n, nao_lidas: naoLidas(email) };
  }
  return { compra: compra, gasto: gasto, lote: lote, listar: listar, naoLidas: naoLidas, marcarLidas: marcarLidas };
})();

rota_('GET', '/api/notificacoes', {}, function (c) { return { itens: NT.listar(c.perfil.email, 50), nao_lidas: NT.naoLidas(c.perfil.email) }; });
rota_('POST', '/api/notificacoes/lidas', {}, function (c) { return NT.marcarLidas(c.perfil.email, Array.isArray(c.body.ids) ? c.body.ids.slice(0, 200) : null); });
