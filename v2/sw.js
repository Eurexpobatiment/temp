/* Ancienne adresse /temp/v2/ : ce service worker se désinstalle et vide sa copie (l'appli est maintenant à /temp/). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("temperatures-fb-v1")).map(k => caches.delete(k))))
    .then(() => self.registration.unregister())
    .then(() => self.clients.matchAll()).then(cs => cs.forEach(c => c.navigate("../"))));
});
