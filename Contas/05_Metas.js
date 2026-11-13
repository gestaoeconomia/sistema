/**
 * Metas / planejamento (viagem, troca de carro, reserva…): quanto o casal precisa guardar por mês para chegar no valor
 * até o mês escolhido.
 *
 *  • guardado = valor que já tinham ao criar a meta + depósitos registrados (retirada = valor negativo).
 *  • n = meses que faltam, contando o mês atual até o mês da meta (inclusive).
 *  • sem rendimento: por mês = falta ÷ n.
 *    com rendimento i ao mês: por mês = (alvo − guardado × (1+i)^n) × i ÷ ((1+i)^n − 1)   (depósito no fim de cada mês).
 *  • o cálculo do mês usa o guardado no INÍCIO do mês; o que já foi depositado no mês abate do "falta guardar este mês".
 *  • a parte de cada um segue o percentual da meta (padrão 50% / 50%).
 * Metas são do casal: os dois veem e alteram; cada depósito registra quem guardou.
 */
var M = (function () {
  var CATEGORIAS = ['VIAGEM', 'CARRO', 'CASA', 'RESERVA', 'ESTUDOS', 'OUTRO'];

  function mesDe(v) { return String(v == null ? '' : v).slice(0, 7); }
  /** Quanto guardar por mês (centavos) para sair de "pv" e chegar em "fv" em n meses, rendendo i ao mês. */
  function porMes(fv, pv, n, i) {
    if (n <= 0) return Math.max(0, fv - pv);
    if (!i) return Math.max(0, Math.ceil((fv - pv) / n));
    var f = Math.pow(1 + i, n), v = (fv - pv * f) * i / (f - 1);
    return Math.max(0, Math.ceil(v));
  }
  function aportesDe(id) { return D.todos('aportes').filter(function (a) { return a.meta_id === id; }); }
  /** Percentual de cada um: pessoa1 fica com pct1 %, o outro com o resto (padrão 50/50). */
  function pctDe(meta, email) {
    var us = P.ativos(), p1 = meta.pct1 === null || meta.pct1 === '' || meta.pct1 === undefined || isNaN(Number(meta.pct1)) ? 50 : Number(meta.pct1);
    var pessoa1 = meta.pessoa1 || (us[0] ? us[0].email : '');
    return email === pessoa1 ? p1 : 100 - p1;
  }
  /** Situação completa de uma meta no mês de referência. */
  function situacao(meta, mesRef) {
    mesRef = U.mesValido(mesRef) ? mesRef : U.mesAtual();
    var alvo = U.centavos(meta.valor_alvo), ini = U.centavos(meta.valor_inicial || 0) || 0, i = (Number(meta.rendimento_mes) || 0) / 100;
    var aps = aportesDe(meta.id), soma = 0, noMes = 0, porPessoa = {}, noMesPessoa = {}, porMesHist = {};
    aps.forEach(function (a) {
      var c = U.centavos(a.valor); if (isNaN(c)) return; soma += c; var m = mesDe(a.data);
      if (m === mesRef) { noMes += c; noMesPessoa[a.quem] = (noMesPessoa[a.quem] || 0) + c; } if (m <= mesRef) porPessoa[a.quem] = (porPessoa[a.quem] || 0) + c;
      porMesHist[m] = (porMesHist[m] || 0) + c;
    });
    var guardado = ini + soma, inicioMes = guardado - noMes, alvoMes = mesDe(meta.mes_alvo);
    var n = U.mesValido(alvoMes) ? U.difMeses(mesRef, alvoMes) + 1 : 0;
    var mensal = guardado >= alvo ? 0 : porMes(alvo, inicioMes, n, i);
    // cada um abate só o que ele mesmo guardou no mês; o total que falta é a soma das partes
    var us0 = P.ativos(), partes = us0.map(function (u) { var pct = pctDe(meta, u.email), parte = Math.ceil(mensal * pct / 100); return { u: u, pct: pct, parte: parte, falta: Math.max(0, parte - (noMesPessoa[u.email] || 0)) }; });
    var faltaMes = us0.length ? partes.reduce(function (t, x) { return t + x.falta; }, 0) : Math.max(0, mensal - noMes);
    if (mensal === 0) faltaMes = 0;
    // ritmo: média dos depósitos dos 3 meses anteriores → previsão de quando chega
    var media = 0; for (var k = 1; k <= 3; k++) media += porMesHist[U.somarMeses(mesRef, -k)] || 0; media = Math.round(media / 3);
    var falta = Math.max(0, alvo - guardado), previsao = null;
    if (falta > 0 && media > 0) previsao = U.somarMeses(mesRef, Math.ceil(falta / media) - 1);
    var us = P.ativos();
    return {
      id: meta.id, nome: meta.nome, categoria: meta.categoria || 'OUTRO', obs: meta.obs || '', ativa: meta.ativa !== 0, concluida_em: meta.concluida_em || '',
      valor_alvo: U.reais(alvo), valor_inicial: U.reais(ini), mes_alvo: alvoMes, rotulo_alvo: U.rotuloMes(alvoMes), rendimento_mes: Number(meta.rendimento_mes) || 0,
      pessoa1: meta.pessoa1 || (us[0] ? us[0].email : ''), pct1: meta.pct1 == null || meta.pct1 === '' ? 50 : Number(meta.pct1),
      guardado: U.reais(guardado), falta: U.reais(falta), progresso: alvo > 0 ? Math.min(100, Math.round(guardado / alvo * 1000) / 10) : 0,
      meses_restantes: Math.max(0, n), vencida: n <= 0 && falta > 0, atingida: guardado >= alvo,
      por_mes: U.reais(mensal), guardado_no_mes: U.reais(noMes), falta_no_mes: U.reais(faltaMes),
      media_3m: U.reais(media), previsao: previsao, rotulo_previsao: previsao ? U.rotuloMes(previsao) : '',
      pessoas: partes.map(function (x) { return { email: x.u.email, nome: x.u.nome, pct: x.pct, por_mes: U.reais(x.parte), falta_no_mes: U.reais(mensal === 0 ? 0 : x.falta), guardou: U.reais(porPessoa[x.u.email] || 0), guardou_no_mes: U.reais(noMesPessoa[x.u.email] || 0) }; }),
      criado_por: meta.criado_por, criado_em: meta.criado_em
    };
  }
  function listar(mesRef) {
    var lista = D.todos('metas').map(function (m) { return situacao(m, mesRef); });
    lista.sort(function (a, b) { return (b.ativa - a.ativa) || String(a.mes_alvo).localeCompare(String(b.mes_alvo)) || a.nome.localeCompare(b.nome, 'pt-BR'); });
    var ativas = lista.filter(function (x) { return x.ativa && !x.atingida; }), tot = {};
    ativas.forEach(function (x) { x.pessoas.forEach(function (p) { var t = tot[p.email] = tot[p.email] || { por_mes: 0, falta_no_mes: 0 }; t.por_mes += U.centavos(p.por_mes); t.falta_no_mes += U.centavos(p.falta_no_mes); }); });
    // ganhos: quanto do que cada um ganha vai para as metas e quanto sobra em média para guardar
    var cap = PN.capacidade(mesRef);
    lista.forEach(function (x) { x.pessoas.forEach(function (p) { var r = cap[p.email] ? cap[p.email].renda : 0; p.pct_renda = r > 0 ? Math.round(U.centavos(p.por_mes) / r * 1000) / 10 : null; }); });
    return { mes: mesRef, rotulo: U.rotuloMes(mesRef), metas: lista,
      total_por_mes: U.reais(ativas.reduce(function (s, x) { return s + U.centavos(x.por_mes); }, 0)),
      total_falta_no_mes: U.reais(ativas.reduce(function (s, x) { return s + U.centavos(x.falta_no_mes); }, 0)),
      pessoas: P.ativos().map(function (u) { var t = tot[u.email] || { por_mes: 0, falta_no_mes: 0 }, c = cap[u.email] || { renda: 0, media_gastos: 0, capacidade: 0 };
        return { email: u.email, nome: u.nome, por_mes: U.reais(t.por_mes), falta_no_mes: U.reais(t.falta_no_mes), renda: U.reais(c.renda), media_gastos: U.reais(c.media_gastos),
          capacidade: U.reais(c.capacidade), pct_renda: c.renda > 0 ? Math.round(t.por_mes / c.renda * 1000) / 10 : null, cabe: c.renda > 0 ? t.por_mes <= c.capacidade : null }; }),
      renda_total: U.reais(Object.keys(cap).reduce(function (s, k) { return s + cap[k].renda; }, 0)),
      capacidade_total: U.reais(Object.keys(cap).reduce(function (s, k) { return s + cap[k].capacidade; }, 0)) };
  }
  function validar(b, atual) {
    var g = function (k) { return b[k] !== undefined ? b[k] : (atual ? atual[k] : undefined); };
    var v = { nome: U.texto(g('nome'), 80), categoria: String(g('categoria') || 'OUTRO'), obs: U.texto(g('obs'), 300), mes_alvo: mesDe(g('mes_alvo')) };
    if (v.nome.length < 2) throw erro_(400, 'Dê um nome para a meta (ex.: Viagem para o Chile).');
    if (CATEGORIAS.indexOf(v.categoria) < 0) v.categoria = 'OUTRO';
    var alvo = U.centavos(g('valor_alvo')); if (isNaN(alvo) || alvo <= 0 || alvo > 1e11) throw erro_(400, 'Informe o valor da meta.'); v.valor_alvo = U.reais(alvo);
    var ini = U.centavos(g('valor_inicial') === '' || g('valor_inicial') == null ? 0 : g('valor_inicial')); if (isNaN(ini) || ini < 0) throw erro_(400, 'Valor já guardado inválido.'); v.valor_inicial = U.reais(ini);
    if (!U.mesValido(v.mes_alvo)) throw erro_(400, 'Informe até quando vocês querem chegar na meta (mês e ano).');
    if (!atual && v.mes_alvo < U.mesAtual()) throw erro_(400, 'O mês da meta já passou. Escolha um mês a partir de ' + U.rotuloMes(U.mesAtual()) + '.');
    var r = Number(String(g('rendimento_mes') == null ? 0 : g('rendimento_mes')).replace(',', '.')); if (isNaN(r) || r < 0 || r > 10) throw erro_(400, 'Rendimento ao mês inválido (ex.: 0,8).'); v.rendimento_mes = Math.round(r * 1000) / 1000;
    var us = P.ativos(), p1 = Number(g('pct1')); if (isNaN(p1)) p1 = 50; if (p1 < 0 || p1 > 100) throw erro_(400, 'A divisão deve ficar entre 0% e 100%.');
    v.pct1 = Math.round(p1); v.pessoa1 = g('pessoa1') || (us[0] ? us[0].email : '');
    return v;
  }
  return { CATEGORIAS: CATEGORIAS, situacao: situacao, listar: listar, validar: validar, porMes: porMes, aportesDe: aportesDe };
})();
