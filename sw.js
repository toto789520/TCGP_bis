// Service Worker pour PWA
const CACHE_NAME = 'poke-tcg-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/generator.js',
  '/favicon.ico',
  '/manifest.json'
];

// Installation du Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache ouvert');
        return cache.addAll(urlsToCache);
      })
  );
});

// Activation et nettoyage des anciens caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Suppression ancien cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Stratégie de cache: Network First, puis Cache
self.addEventListener('fetch', event => {
  // Ignorer les requêtes POST et autres méthodes non-GET
  if (event.request.method !== 'GET') {
    return;
  }
  
  // Ignorer les requêtes Firebase
  if (event.request.url.includes('firebasestorage') || 
      event.request.url.includes('firebaseapp') ||
      event.request.url.includes('googleapis')) {
    return;
  }
  
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Ne cacher que les réponses réussies
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        
        // Cloner la réponse
        const responseToCache = response.clone();
        
        caches.open(CACHE_NAME)
          .then(cache => {
            cache.put(event.request, responseToCache);
          });
        
        return response;
      })
      .catch(() => {
        // Si le réseau échoue, utiliser le cache
        return caches.match(event.request);
      })
  );
});
