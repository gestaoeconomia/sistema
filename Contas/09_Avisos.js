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
  function urlApp() { try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; } }
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
          if (x.pago_por !== u.email || x.data < hoje || x.data > ate) return;
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
  return { prefs: prefs, salvarPrefs: salvarPrefs, acionadorAtivo: acionadorAtivo, rodar: rodar, teste: teste, lembretesDe: lembretesDe, resumoMensal: resumoMensal };
})();

/** Acionador diário (criado pelo instalar()/criarAcionadorAvisos()). Não chame pelo app. */
function avisosDiarios(e) { exigirInterno_(e); var r = AV.rodar(); console.log(r.join('\n') || 'Nada a avisar hoje.'); return r; }
