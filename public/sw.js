const CACHE = 'kith-v1'

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/sw.js'])))
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  )
})

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  const url = new URL(e.request.url)

  // API calls: network-first, serve stale when offline
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()))
          return res
        })
        .catch(() => caches.match(e.request))
    )
    return
  }

  // HTML document: network-first so deploys take effect immediately
  if (url.pathname === '/' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()))
          return res
        })
        .catch(() => caches.match(e.request))
    )
    return
  }

  // Static assets (JS/CSS/images): cache-first, refresh in background
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        if (res && res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()))
        return res
      }).catch(() => cached)
      return cached || fresh
    })
  )
})

// Push notifications
self.addEventListener('push', e => {
  if (!e.data) return
  const data = e.data.json()
  e.waitUntil(
    self.registration.showNotification(data.title || 'Kith', {
      body: data.body || '',
      icon: '/icon.png',
      badge: '/icon.png',
      tag: data.tag || 'kith',
      renotify: true,
    })
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if (c.url && 'focus' in c) return c.focus() }
      if (clients.openWindow) return clients.openWindow('/')
    })
  )
})
