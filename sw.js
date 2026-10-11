// Service worker do Metrify
// - Página principal (index.html): tenta a rede primeiro e usa a cópia guardada se estiver sem internet.
//   Assim, atualizar o index.html no GitHub chega ao app sem precisar mexer neste arquivo.
// - Ícones e manifesto: usa a cópia guardada e atualiza em segundo plano.
// - SDK do Firebase (www.gstatic.com): guardado após o primeiro uso, para o app abrir sem internet.
// - Todo o resto (Firestore, login do Google) vai direto para a rede, sem interferência.
// Se mudar a lógica deste arquivo, troque o número em VERSAO para limpar o cache antigo.

const VERSAO = 'metrify-v1';
const ARQUIVOS = [
  './', './index.html', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'
];
const LIMITE_REDE_MS = 4000;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSAO);
    await Promise.all(ARQUIVOS.map(u => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSAO) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function redePrimeiro(req) {
  const c = await caches.open(VERSAO);
  let ruim = null;
  // A busca segue em segundo plano mesmo se o limite de tempo estourar, e atualiza a cópia guardada
  // (assim, numa internet lenta, a versão nova aparece na abertura seguinte).
  const busca = fetch(req.url, { cache: 'no-cache' }).then(r => {
    if (r.ok) { // é sempre a mesma página: mantém todas as entradas ('/' e '/index.html') com a versão mais nova
      c.put(req, r.clone()); c.put('./index.html', r.clone()); c.put('./', r.clone());
    }
    return r;
  });
  busca.catch(() => {});
  try {
    const r = await Promise.race([
      busca,
      new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), LIMITE_REDE_MS))
    ]);
    if (r.ok) return r;
    ruim = r; // erro do servidor: prefere a cópia guardada, se houver
  } catch (_) {}
  return (await c.match(req, { ignoreSearch: true }))
    || (await c.match('./index.html'))
    || (await c.match('./'))
    || ruim
    || Response.error();
}

async function cacheEAtualiza(req) {
  const c = await caches.open(VERSAO);
  const guardado = await c.match(req);
  const busca = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
  return guardado || (await busca) || Response.error();
}

async function cachePrimeiro(req) {
  const c = await caches.open(VERSAO);
  const guardado = await c.match(req);
  if (guardado) return guardado;
  const r = await fetch(req);
  if (r.ok) c.put(req, r.clone());
  return r;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const mesmaOrigem = url.origin === self.location.origin;
  if (mesmaOrigem && (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'))) {
    e.respondWith(redePrimeiro(req));
  } else if (mesmaOrigem) {
    e.respondWith(cacheEAtualiza(req));
  } else if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith(cachePrimeiro(req));
  }
});
