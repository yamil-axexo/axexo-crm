// CONTIGO: avisos del navegador (AUT-05). Solo muestra el aviso que llega cifrado y abre su enlace dentro de CONTIGO.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { data = {} }
  const title = typeof data.title === 'string' ? data.title.slice(0, 120) : 'CONTIGO'
  const body = typeof data.body === 'string' ? data.body.slice(0, 300) : ''
  const link = typeof data.link === 'string' && data.link.startsWith('/') ? data.link : '/avisos'
  event.waitUntil(self.registration.showNotification(title, { body, data: { link }, icon: '/icon-192.png' }))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification.data && event.notification.data.link) || '/avisos'
  event.waitUntil(self.clients.openWindow(link))
})
