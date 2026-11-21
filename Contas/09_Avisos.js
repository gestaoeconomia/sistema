/**
 * Avisos por e-mail (enviados pela conta dona do script, uma vez por dia, pelo acionador "avisosDiarios"):
 *  • Lembretes: fatura dos SEUS cartões e gastos fixos de pix/débito que vencem em até 3 dias; acerto pendente
 *    no fim do mês; categoria que passou de 80% ou de 100% do limite.
 *  • Resumo do mês (todo dia 1º): ganhos, sua parte dos gastos, quanto guardou, categorias, limites e acerto.
 * Cada pessoa recebe só o que é dela (mesma regra de privacidade do app). Liga/desliga em "Minha conta".
 */
var AV = (function () {
  var PADRAO = { lembretes: true, resumo: true, limites: true };
  function prefs(email) {
    var p = {}; try { p = JSON.parse(D.config('avisos:' + email, '{}')) || {}; } catch (e) { p = {}; }
    return { lembretes: p.lembretes !== false, resumo: p.resumo !== false, limites: p.limites !== false };
  }
  function salvarPrefs(email, b) {
    var p = prefs(email); Object.keys(PADRAO).forEach(function (k) { if (typeof b[k] === 'boolean') p[k] = b[k]; });
    D.definirConfig('avisos:' + email, JSON.stringify(p)); return p;
  }
  function acionadorAtivo() { try { return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'avisosDiarios'; }); } catch (e) { return null; } }
  function urlApp() { try { return linkPublico_() || ''; } catch (e) { return ''; } } // V1.2: link sem /a/macros/ nem /u/1/ (ou a página de acesso externa)
  function somarDias(iso, n) { var d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function brl(v) { var n = Number(v) || 0, s = Math.abs(n).toFixed(2).split('.'); return (n < 0 ? '−' : '') + 'R$ ' + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + s[1]; }
  function dm(iso) { return String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------- controle de "já avisei" (propriedades com prefixo av_, limpas após 70 dias) ----------
  function jaAvisou(chave) { return !!D.props().getProperty('av_' + chave); }
  function marcar(chave, hoje) { D.props().setProperty('av_' + chave, hoje); }
  function limparMarcas(hoje) {
    var p = D.props(), todas = p.getProperties(), lim = somarDias(hoje, -70);
    Object.keys(todas).forEach(function (k) { if (k.indexOf('av_') === 0 && String(todas[k]) < lim) p.deleteProperty(k); });
  }

  // ---------- conteúdo ----------
  function frasePendente(pend, email) {
    if (!pend) return '';
    if (pend.devedor.email === email) return 'Você deve ' + brl(pend.valor) + ' a ' + P.primeiroNome(pend.credor.nome);
    return P.primeiroNome(pend.devedor.nome) + ' deve ' + brl(pend.valor) + ' a você';
  }
  /** Itens de lembrete de hoje para uma pessoa. teste=true ignora o "já avisei" e não marca nada. */
  /** V1.5: situação do teto geral do mês (sua parte dos gastos × teto definido). */
  function tetoDe(email, mes) { if (!PREV.teto(email)) return null; var idx = R.indice(); return PREV.situacaoTeto(email, PN.suaParte(idx, mes, email).total, null); }
  function lembretesDe(u, hoje, teste) {
    var pr = prefs(u.email), out = [], novas = [], ate = somarDias(hoje, 3), mes = hoje.slice(0, 7), meses = [mes, U.somarMeses(mes, 1)];
    var add = function (chave, texto) { if (!teste && jaAvisou(chave)) return; out.push(texto); novas.push(chave); };
    if (pr.lembretes) {
      meses.forEach(function (m) {
        R.faturasDoMes(m, u.email).forEach(function (f) {
          if (f.titular !== u.email || f.paga || !(f.total > 0) || f.vencimento < hoje || f.vencimento > ate) return;
          add('fat|' + f.id + '|' + m + '|' + u.email, 'Fatura <b>' + esc(f.nome) + '</b> vence ' + (f.vencimento === hoje ? '<b>hoje</b>' : 'em ' + dm(f.vencimento)) + ': <b>' + brl(f.total) + '</b>');
        });
        R.gastosFixosDoMes(m, u.email).forEach(function (x) {
          if (x.pago_por !== u.email || x.data < hoje || x.data > ate || VENC.pagamento(x.id, m)) return;   // V1.5: já marcado como pago
          add('fixo|' + x.id + '|' + m + '|' + u.email, 'Gasto fixo <b>' + esc(x.descricao) + '</b> (' + esc({ PIX: 'pix', DEBITO: 'débito', DINHEIRO: 'dinheiro' }[x.forma] || x.forma) + ') vence ' + (x.data === hoje ? '<b>hoje</b>' : 'em ' + dm(x.data)) + ': <b>' + brl(x.valor) + '</b>');
        });
      });
      // acerto: nos 2 últimos dias do mês, se ainda houver saldo envolvendo a pessoa
      var dias = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).getUTCDate();
      if (Number(hoje.slice(8, 10)) >= dias - 1 || teste) {
        var ac = R.acerto(mes);
        if (ac.pendente) add('acerto|' + mes + '|' + u.email, 'Acerto de ' + esc(ac.rotulo) + ': <b>' + esc(frasePendente(ac.pendente, u.email)) + '</b>.');
      }
    }
    if (pr.limites) {
      var tt = tetoDe(u.email, mes);   // V1.5: teto geral do mês
      if (tt && (tt.nivel === 'atencao' || tt.nivel === 'estourou')) add('orc|' + u.email + '|' + mes + '|' + tt.nivel, (tt.nivel === 'estourou' ? 'Você passou do <b>teto do mês</b>' : 'Atenção ao <b>teto do mês</b>') + ': ' + brl(tt.gasto) + ' de ' + brl(tt.teto) + ' (' + String(tt.pct).replace('.', ',') + '%).');
      PN.situacaoLimites(R.indice(), mes, u.email).forEach(function (l) {
        if (l.nivel === 'ok') return;
        add('lim|' + l.id + '|' + mes + '|' + l.nivel, (l.nivel === 'estourou' ? 'Limite estourado' : 'Atenção ao limite') + ' em <b>' + esc(l.categoria) + '</b>: ' + brl(l.gasto) + ' de ' + brl(l.teto) + ' (' + String(l.pct).replace('.', ',') + '%).');
      });
    }
    return { itens: out, chaves: novas };
  }
  function resumoMensal(u, mes) {
    var idx = R.indice(), renda = PN.rendaPorPessoa(mes)[u.email] || 0, parte = PN.suaParte(idx, mes, u.email), guard = PN.aportesNoMes(mes, u.email);
    var antes = PN.suaParte(idx, U.somarMeses(mes, -1), u.email).total, cats = Object.keys(parte.cats).map(function (k) { return { nome: parte.nomes[k], c: parte.cats[k] }; }).filter(function (x) { return x.c > 0; }).sort(function (a, b) { return b.c - a.c; }).slice(0, 5);
    var lim = PN.situacaoLimites(idx, mes, u.email), ac = R.acertoComIndice(mes, idx), prox = U.somarMeses(mes, 1);
    var comprometido = (idx[prox] || []).filter(function (it) { return it.origem === 'CARTAO' || it.recorrente; }).reduce(function (s, it) { return s + R.minhaParte(it, u.email); }, 0);
    var linha = function (a, b, forte) { return '<tr><td style="padding:4px 12px 4px 0;color:#475569">' + a + '</td><td style="padding:4px 0;text-align:right;' + (forte ? 'font-weight:700' : '') + '">' + b + '</td></tr>'; };
    var h = '<h2 style="margin:0 0 4px;font-size:18px">Resumo de ' + esc(U.rotuloMes(mes)) + '</h2><p style="margin:0 0 14px;color:#64748b">Só os seus números (sua parte dos gastos divididos incluída).</p><table style="border-collapse:collapse;min-width:280px">';
    if (renda) h += linha('Ganhos', brl(U.reais(renda)));
    h += linha('Sua parte dos gastos', brl(U.reais(parte.total)) + (antes ? ' <span style="color:#64748b;font-weight:400">(' + (parte.total >= antes ? '+' : '') + String(Math.round((parte.total - antes) / antes * 1000) / 10).replace('.', ',') + '% vs mês anterior)</span>' : ''));
    if (guard) h += linha('Guardado nas metas', brl(U.reais(guard)));
    if (renda) h += linha('Sobrou', brl(U.reais(renda - parte.total - guard)), true);
    h += '</table>';
    if (cats.length) h += '<h3 style="font-size:15px;margin:18px 0 6px">Onde foi o dinheiro</h3><table style="border-collapse:collapse;min-width:280px">' + cats.map(function (x) { return linha(esc(x.nome), brl(U.reais(x.c))); }).join('') + '</table>';
    if (lim.length) h += '<h3 style="font-size:15px;margin:18px 0 6px">Limites por categoria</h3><table style="border-collapse:collapse;min-width:280px">' + lim.map(function (l) { return linha(esc(l.categoria), brl(l.gasto) + ' de ' + brl(l.teto) + ' ' + (l.nivel === 'estourou' ? '🔴' : l.nivel === 'atencao' ? '🟡' : '🟢')); }).join('') + '</table>';
    if (ac.pendente) h += '<p style="margin:18px 0 0"><b>Acerto de ' + esc(ac.rotulo) + ':</b> ' + esc(frasePendente(ac.pendente, u.email)) + '.</p>';
    else if (ac.completo && ac.devido) h += '<p style="margin:18px 0 0">Acerto de ' + esc(ac.rotulo) + ': quitado ✓</p>';
    h += '<p style="margin:12px 0 0;color:#475569">Já comprometido em ' + esc(U.rotuloMes(prox)) + ' (parcelas e gastos fixos): <b>' + brl(U.reais(comprometido)) + '</b>.</p>';
    return h;
  }
  function moldura(titulo, corpo) {
    var url = urlApp();
    return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;max-width:560px">' + corpo +
      (url ? '<p style="margin:22px 0 0"><a href="' + esc(url) + '" style="background:#0E4D5B;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none;display:inline-block">Abrir a Gestão Financeira</a></p>' : '') +
      '<p style="margin:18px 0 0;font-size:12px;color:#94a3b8">Para parar de receber, desligue em Minha conta → Avisos por e-mail.</p></div>';
  }
  function enviar(para, assunto, html) { MailApp.sendEmail({ to: para, subject: assunto, htmlBody: html, name: APP.TITULO }); }

  /** Rotina diária (acionador). Retorna o que foi enviado (para o log do editor). */
  function rodar(hojeOpc) {
    var hoje = hojeOpc || D.hojeISO(), log = [];
    P.ativos().forEach(function (u) {
      try {
        var l = lembretesDe(u, hoje, false);
        if (l.itens.length) {
          enviar(u.email, l.itens.length === 1 ? 'Lembrete: ' + l.itens[0].replace(/<[^>]+>/g, '').slice(0, 80) : l.itens.length + ' lembretes das suas contas',
            moldura('Lembretes', '<h2 style="margin:0 0 10px;font-size:18px">Olá, ' + esc(P.primeiroNome(u.nome)) + '!</h2><ul style="padding-left:18px;margin:0">' + l.itens.map(function (x) { return '<li style="margin:6px 0">' + x + '</li>'; }).join('') + '</ul>'));
          l.chaves.forEach(function (k) { marcar(k, hoje); }); log.push(u.email + ': ' + l.itens.length + ' lembrete(s)');
        }
        if (hoje.slice(8, 10) === '01' && prefs(u.email).resumo) {
          var mesAnt = U.somarMeses(hoje.slice(0, 7), -1), chave = 'resumo|' + mesAnt + '|' + u.email;
          if (!jaAvisou(chave)) { enviar(u.email, 'Resumo de ' + U.rotuloMes(mesAnt) + ' — ' + APP.TITULO, moldura('Resumo', resumoMensal(u, mesAnt))); marcar(chave, hoje); log.push(u.email + ': resumo de ' + mesAnt); }
        }
      } catch (e) { log.push(u.email + ': ERRO ' + e.message); }
    });
    limparMarcas(hoje); D.descarregarAuditoria();
    return log;
  }
  /** E-mail de teste para quem pediu: mostra os lembretes de hoje (mesmo os já avisados) e o resumo do mês passado. */
  function teste(perfil) {
    var u = P.ativos().filter(function (x) { return x.email === perfil.email; })[0] || { email: perfil.email, nome: perfil.nome }, hoje = D.hojeISO();
    var l = lembretesDe(u, hoje, true), mesAnt = U.somarMeses(hoje.slice(0, 7), -1);
    var corpo = '<h2 style="margin:0 0 10px;font-size:18px">E-mail de teste</h2><p style="margin:0 0 10px;color:#64748b">Assim chegam os avisos. Lembretes de hoje:</p>' +
      (l.itens.length ? '<ul style="padding-left:18px;margin:0 0 18px">' + l.itens.map(function (x) { return '<li style="margin:6px 0">' + x + '</li>'; }).join('') + '</ul>' : '<p style="margin:0 0 18px">Nenhum lembrete para hoje.</p>') +
      '<hr style="border:0;border-top:1px solid #e2e8f0;margin:18px 0">' + resumoMensal(u, mesAnt);
    enviar(u.email, 'Teste — avisos da ' + APP.TITULO, moldura('Teste', corpo));
    D.auditar(perfil.email, 'Enviou e-mail de teste', 'config', 'avisos:' + perfil.email, null);
    return { ok: true, para: u.email, lembretes: l.itens.length };
  }
  /**
   * V1.2 (do SIG V6.5/V6.6 — notificações no app e selos na barra lateral): os mesmos lembretes do e-mail, na hora, dentro do app.
   * Não depende das preferências de e-mail nem do "já avisei". Cada item diz para qual tela levar (rota) e conta no selo dela.
   *  • faturas dos SEUS cartões não pagas que vencem em até 3 dias ou que venceram há até 10 dias;
   *  • gastos fixos de pix/débito seus que vencem em até 3 dias;
   *  • categorias acima de 80% do limite no mês atual;
   *  • acerto pendente do mês que passou (e do atual, nos 2 últimos dias do mês).
   */
  function itensApp(email, hojeOpc) {
    var hoje = hojeOpc || D.hojeISO(), ate = somarDias(hoje, 3), desde = somarDias(hoje, -10), mes = hoje.slice(0, 7), out = [];
    [U.somarMeses(mes, -1), mes, U.somarMeses(mes, 1)].forEach(function (m) {
      R.faturasDoMes(m, email).forEach(function (f) {
        if (f.titular !== email || f.paga || !(f.total > 0) || f.vencimento < desde || f.vencimento > ate) return;
        var venceu = f.vencimento < hoje;
        out.push({ tipo: venceu ? 'atraso' : 'fatura', nivel: venceu || f.vencimento === hoje ? 'alto' : 'medio', rota: 'faturas', query: { cartao: f.id, mes: m },
          titulo: (venceu ? 'Fatura vencida: ' : 'Fatura ') + f.nome, texto: (venceu ? 'Venceu em ' + dm(f.vencimento) : f.vencimento === hoje ? 'Vence hoje' : 'Vence em ' + dm(f.vencimento)) + ' · ' + brl(f.total) + (venceu ? ' · se já pagou, marque como paga' : ''), data: f.vencimento });
      });
    });
    [U.somarMeses(mes, -1), mes, U.somarMeses(mes, 1)].forEach(function (m) {
      R.gastosFixosDoMes(m, email).forEach(function (x) {
        // V1.5: os já marcados como pagos saem; os vencidos há até 10 dias e não marcados aparecem como atrasados
        if (x.pago_por !== email || x.data < desde || x.data > ate || VENC.pagamento(x.id, m)) return;
        var venceu = x.data < hoje;
        out.push({ tipo: venceu ? 'atraso' : 'fixo', nivel: venceu || x.data === hoje ? 'alto' : 'medio', rota: 'vencimentos', query: { mes: m }, titulo: (venceu ? 'Gasto fixo atrasado: ' : 'Gasto fixo: ') + x.descricao,
          texto: (venceu ? 'Venceu em ' + dm(x.data) : x.data === hoje ? 'Vence hoje' : 'Vence em ' + dm(x.data)) + ' · ' + brl(x.valor) + ' (' + ({ PIX: 'pix', DEBITO: 'débito', DINHEIRO: 'dinheiro' }[x.forma] || x.forma) + ')' + (venceu ? ' · se já pagou, marque como pago' : ''), data: x.data });
      });
    });
    var tt = tetoDe(email, mes);
    if (tt && tt.nivel !== 'ok') out.push({ tipo: 'limite', nivel: tt.nivel === 'estourou' ? 'alto' : 'medio', rota: 'resumo', query: {}, titulo: tt.nivel === 'estourou' ? 'Passou do teto do mês' : tt.nivel === 'previsao' ? 'No ritmo atual, vai passar do teto' : 'Perto do teto do mês',
      texto: brl(tt.gasto) + ' de ' + brl(tt.teto) + ' (' + String(tt.pct).replace('.', ',') + '%) em ' + U.rotuloMes(mes), data: hoje });
    PN.situacaoLimites(R.indice(), mes, email).forEach(function (l) {
      if (l.nivel === 'ok') return;
      out.push({ tipo: 'limite', nivel: l.nivel === 'estourou' ? 'alto' : 'medio', rota: 'resumo', query: {}, titulo: (l.nivel === 'estourou' ? 'Limite estourado: ' : 'Perto do limite: ') + l.categoria,
        texto: brl(l.gasto) + ' de ' + brl(l.teto) + ' (' + String(l.pct).replace('.', ',') + '%) em ' + U.rotuloMes(mes), data: hoje });
    });
    var dias = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).getUTCDate(), mesesAc = [U.somarMeses(mes, -1)];
    if (Number(hoje.slice(8, 10)) >= dias - 1) mesesAc.push(mes);
    mesesAc.forEach(function (m) {
      var ac = R.acerto(m); if (!ac.pendente) return;
      out.push({ tipo: 'acerto', nivel: ac.pendente.devedor.email === email ? 'alto' : 'medio', rota: 'acerto', query: { mes: m }, titulo: 'Acerto de ' + U.rotuloMes(m), texto: frasePendente(ac.pendente, email) + '.', data: m + '-01' });
    });
    var ordem = { alto: 0, medio: 1 };
    out.sort(function (a, b) { return ordem[a.nivel] - ordem[b.nivel] || ORD_TXT_(a.data, b.data); });
    var selos = {}; out.forEach(function (x) { selos[x.rota] = (selos[x.rota] || 0) + 1; });
    return { itens: out, selos: selos, hoje: hoje };
  }
  return { itensApp: itensApp, prefs: prefs, salvarPrefs: salvarPrefs, acionadorAtivo: acionadorAtivo, rodar: rodar, teste: teste, lembretesDe: lembretesDe, resumoMensal: resumoMensal };
})();

/** Acionador diário (criado pelo instalar()/criarAcionadorAvisos()). Não chame pelo app. */
function avisosDiarios(e) { exigirInterno_(e); var r = AV.rodar(); console.log(r.join('\n') || 'Nada a avisar hoje.'); return r; }
