// Nom du cache (change le numéro de version si tu veux forcer une mise à jour globale plus tard)
const CACHE_NAME = 'tcg-card-images-v1';

// L'événement 'install' se lance quand le Service Worker est mis en place
self.addEventListener('install', (event) => {
    self.skipWaiting(); // Force l'activation immédiate
});

// L'événement 'fetch' se lance à CHAQUE requête réseau (image, css, js...)
self.addEventListener('fetch', (event) => {
    
    // On ne s'intéresse qu'aux images (png, jpg, svg...)
    if (event.request.destination === 'image') {
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) => {
                // 1. On regarde si l'image est déjà dans le coffre-fort (Cache)
                return cache.match(event.request).then((cachedResponse) => {
                    
                    // SI OUI : On la rend tout de suite ! (Pas de réseau)
                    if (cachedResponse) {
                        return cachedResponse;
                    }

                    // SI NON : On la télécharge, on la met dans le coffre, et on la rend
                    return fetch(event.request).then((networkResponse) => {
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    });
                });
            })
        );
    }
    // Pour tout le reste (HTML, JS...), on laisse faire le réseau normalement
});