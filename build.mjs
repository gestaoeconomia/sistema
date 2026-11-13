// Gera o site estático (pasta docs/) a partir dos arquivos do Apps Script (pasta Contas/).
// Uso:  node build.mjs      (Node 18+; não precisa instalar nada)
// O GitHub Pages publica a pasta docs/. O site fala com o Apps Script pelo link /exec gravado em docs/config.js.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(fileURLToPath(import.meta.url));
const src = join(raiz, 'Contas'), out = join(raiz, 'docs'), icones = join(raiz, 'icones');
const ler = f => readFileSync(join(src, f), 'utf8');

const versao = (ler('00_Config.js').match(/VERSAO:\s*'([^']+)'/) || [, ''])[1];
const titulo = (ler('00_Config.js').match(/TITULO:\s*'([^']+)'/) || [, 'Gestão Financeira'])[1];
const nomeCurto = 'Finanças';

let html = ler('Index.html')
  .replace(/<\?!=\s*include\('([^']+)'\)\s*\?>/g, (_, n) => ler(n + '.html'))
  .replace(/<\?!=\s*versao\s*\?>/g, versao.replace(/'/g, "\\'"));
if (/<\?/.test(html)) throw new Error('Sobrou marcação do Apps Script no Index.html');

const cabeca = `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#EEF4F5">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="${nomeCurto}">
<meta name="format-detection" content="telephone=no">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="icones/icone-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="icones/icone-180.png">
<link rel="apple-touch-icon" sizes="167x167" href="icones/icone-167.png">
<link rel="apple-touch-icon" sizes="152x152" href="icones/icone-152.png">
<script>window.SITE_ESTATICO = true;</script>
<script src="config.js?v=${encodeURIComponent(versao)}"></script>`;
html = html.replace(/<meta name="viewport"[^>]*>/, cabeca);
// registra o service worker (abre mais rápido e permite atualizar sozinho)
html = html.replace('</body>', `<script>if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));</script>\n</body>`);

mkdirSync(join(out, 'icones'), { recursive: true });
writeFileSync(join(out, 'index.html'), html);
for (const f of readdirSync(icones)) if (/\.(png|svg)$/.test(f)) copyFileSync(join(icones, f), join(out, 'icones', f));
writeFileSync(join(out, '.nojekyll'), '');
writeFileSync(join(out, 'manifest.webmanifest'), JSON.stringify({
  name: titulo, short_name: nomeCurto, lang: 'pt-BR', start_url: './#/resumo', scope: './', display: 'standalone',
  background_color: '#EEF4F5', theme_color: '#EEF4F5', orientation: 'portrait',
  icons: [
    { src: 'icones/icone-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icones/icone-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icones/icone-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
}, null, 2));
writeFileSync(join(out, 'sw.js'), `// Service worker: guarda a "casca" do app; sempre tenta a rede primeiro (atualizações chegam na hora).
const CACHE = 'gestao-financeira-${versao.replace(/[^\w.-]+/g, '_')}';
const CASCA = ['./', './index.html', './config.js', './manifest.webmanifest', './icones/icone-180.png', './icones/icone-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CASCA)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // a API (Apps Script) nunca passa pelo cache
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
});
`);
// config.js é seu: só é criado se ainda não existir (o build nunca apaga o link que você colou)
if (!existsSync(join(out, 'config.js'))) writeFileSync(join(out, 'config.js'),
`// Cole entre as aspas o link do App da Web do Apps Script (Implantar > Gerenciar implantações > URL do app da Web).
// Ele termina em /exec. Exemplo: 'https://script.google.com/macros/s/AKfy.../exec'
window.API_URL = '';
`);
console.log('Site gerado em docs/ (' + versao + ').');
