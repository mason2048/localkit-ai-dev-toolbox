const CACHE = 'localkit-v0.2.0'
const CACHE_PREFIX = 'localkit-'
const SHELL = ['./', './index.html', './manifest.webmanifest', ...__LOCALKIT_PRECACHE_ASSETS__]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE)
          await cache.put('./index.html', response.clone())
        }
        return response
      }).catch(async () => {
        const cache = await caches.open(CACHE)
        return cache.match('./index.html').then((cached) => cached || cache.match('./'))
      }),
    )
    return
  }
  const requestUrl = new URL(event.request.url)
  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    return cache.match(event.request, { ignoreSearch: true }).then(async (cached) => {
      if (cached) return cached
      const pathMatch = await cache.match(`.${requestUrl.pathname}`, { ignoreSearch: true })
      if (pathMatch) return pathMatch
      return fetch(event.request).then(async (response) => {
      if (response.ok) {
        await cache.put(event.request, response.clone())
      }
      return response
      })
    })
  })())
})
