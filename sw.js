const CACHE = 'linktree-v1';
self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll([
    'index.html',
    'https://cdn.tailwindcss.com',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
  ]))
));
self.addEventListener('fetch', e => e.respondWith(
  caches.match(e.request).then(res => res || fetch(e.request))
));