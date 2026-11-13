/**
 * Gestão Financeira — controle de custos do casal (Google Apps Script + Google Planilhas).
 * Configuração, utilitários comuns e perfil do usuário.
 *
 * Convenções (mesma estrutura do Sistema Integrado de Gestão):
 *  • Funções públicas (chamáveis pelo navegador): somente doGet() e api(). Todo o restante é privado
 *    (módulos em objetos globais D, P, A, R) ou termina em "_".
 *  • Funções administrativas (instalar, redefinirSenha etc.) só rodam pelo editor do Apps Script (conta proprietária).
 *  • Valores em dinheiro são calculados em CENTAVOS (inteiros) e gravados na planilha com 2 casas decimais.
 */
var APP = { TZ: 'America/Recife', TITULO: 'Gestão Financeira', VERSAO: 'V1.2 - 13/11/2026', MAX_USUARIOS: 2 };

function erro_(status, msg, extra) {
  var e = new Error(msg); e.status = status;
  if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
  return e;
}

/** Utilitários de mês (AAAA-MM), data (AAAA-MM-DD) e dinheiro (centavos). */
var U = (function () {
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function mesValido(m) { return typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m); }
  function dataValida(d) {
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    var x = new Date(d + 'T12:00:00Z'); return !isNaN(x) && x.toISOString().slice(0, 10) === d;
  }
  /** Soma n meses a "AAAA-MM" (n pode ser negativo). */
  function somarMeses(mes, n) {
    var a = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7)) - 1 + n;
    a += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return a + '-' + pad(m + 1);
  }
  /** Quantos meses de "de" até "ate" (ate − de). */
  function difMeses(de, ate) { return (Number(ate.slice(0, 4)) - Number(de.slice(0, 4))) * 12 + Number(ate.slice(5, 7)) - Number(de.slice(5, 7)); }
  function rotuloMes(mes) { return mesValido(mes) ? MESES[Number(mes.slice(5, 7)) - 1] + ' de ' + mes.slice(0, 4) : ''; }
  function mesAtual() { return D.hojeISO().slice(0, 7); }
  /** Valor em reais (número ou texto "1.234,56") → centavos inteiros. NaN se inválido. */
  function centavos(v) {
    if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) : NaN;
    var s = String(v == null ? '' : v).trim().replace(/[R$\s]/g, ''); if (!s) return NaN;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    var n = Number(s); return isFinite(n) ? Math.round(n * 100) : NaN;
  }
  function reais(c) { return Math.round(c) / 100; }
  function texto(v, max) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, max || 120); }
  return { MESES: MESES, pad: pad, mesValido: mesValido, dataValida: dataValida, somarMeses: somarMeses, difMeses: difMeses, rotuloMes: rotuloMes, mesAtual: mesAtual, centavos: centavos, reais: reais, texto: texto };
})();

/**
 * Perfil: só existem duas pessoas (o casal), com o mesmo acesso. Não há cargos nem administrador dentro do app.
 * Cada um vê tudo; altera/exclui apenas o que é seu (seus cartões, compras nos seus cartões, gastos que pagou).
 */
var P = (function () {
  function emailValido(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim()) && String(e).length <= 200; }
  function ativos() { return D.todos('usuarios').filter(function (u) { return u.ativo === 1; }).sort(function (a, b) { return String(a.criado_em).localeCompare(String(b.criado_em)); }); }
  function nomeDe(email) { var u = D.porId('usuarios', email); return u ? u.nome : (email || ''); }
  function primeiroNome(nome) { return String(nome || '').trim().split(/\s+/)[0] || ''; }
  /** O(a) parceiro(a) de quem está logado (o outro usuário ativo), ou null se ainda não se cadastrou. */
  function parceiroDe(email) { return ativos().filter(function (u) { return u.email !== email; })[0] || null; }
  function perfilDe(u) {
    if (!u) return null;
    var p = parceiroDe(u.email);
    return { email: u.email, nome: u.nome, apelido: primeiroNome(u.nome), tem_senha: A.temSenhaLocal(u.email),
      parceiro: p ? { email: p.email, nome: p.nome, apelido: primeiroNome(p.nome) } : null };
  }
  return { emailValido: emailValido, ativos: ativos, nomeDe: nomeDe, primeiroNome: primeiroNome, parceiroDe: parceiroDe, perfilDe: perfilDe };
})();
