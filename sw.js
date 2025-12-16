// Service Worker pour PWA
const CACHE_NAME = 'poke-tcg-v5';
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/generator.js',
  '/favicon.ico',
  '/manifest.json'
];

// Fonction de logging pour le Service Worker
function swLog(level, message, data = null) {
  // Seules les erreurs et warnings sont loggées pour éviter le spam console
  if (level === 'debug' || level === 'info') return;
  const timestamp = new Date().toISOString();
  const logMessage = `[SW-${level.toUpperCase()}] ${timestamp}: ${message}`;
  if (level === 'error') console.error(logMessage, data || '');
  else if (level === 'warn') console.warn(logMessage, data || '');
}

// Installation du Service Worker
self.addEventListener('install', event => {
  swLog('info', 'Installation du Service Worker');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        swLog('info', 'Cache ouvert, ajout des ressources');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        swLog('info', 'Toutes les ressources ont été mises en cache');
      })
      .catch(error => {
        swLog('error', 'Erreur lors de la mise en cache', error);
      })
  );
});

// Activation et nettoyage des anciens caches
self.addEventListener('activate', event => {
  swLog('info', 'Activation du Service Worker');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            swLog('info', 'Suppression ancien cache: ' + cacheName);
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
  
  // Ignorer les requêtes Firebase et Google Auth
  if (event.request.url.includes('firebasestorage') || 
      event.request.url.includes('firebaseapp') ||
      event.request.url.includes('googleapis') ||
      event.request.url.includes('google.com/accounts') ||
      event.request.url.includes('gstatic.com/firebasejs') ||
      event.request.url.includes('identitytoolkit') ||
      event.request.url.includes('securetoken') ||
      event.request.url.includes('__/auth/')) {
    swLog('debug', 'Requête Firebase/Auth ignorée: ' + event.request.url);
    return;
  }
  
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Ne cacher que les réponses réussies
        if (!response || response.status !== 200 || response.type !== 'basic') {
          if (response && response.status === 404) {
            swLog('warn', 'Ressource 404: ' + event.request.url);
          }
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
      .catch(error => {
        swLog('warn', 'Fetch échoué, utilisation du cache pour: ' + event.request.url, error);
        // Si le réseau échoue, utiliser le cache
        return caches.match(event.request).then(cachedResponse => {
          // Si c'est une requête de navigation et qu'il n'y a pas de cache, retourner index.html
          if (!cachedResponse && event.request.mode === 'navigate') {
            swLog('info', 'Redirection navigation vers index.html pour: ' + event.request.url);
            return caches.match('/index.html');
          }
          if (!cachedResponse) {
            swLog('error', 'Aucun cache disponible pour: ' + event.request.url);
          }
          return cachedResponse;
        });
      })
  );
});

// Gestion des clics sur les notifications
self.addEventListener('notificationclick', event => {
  swLog('info', 'Notification cliquée: ' + event.notification.tag);
  
  event.notification.close();
  
  // Ouvrir ou focus l'application
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Si une fenêtre est déjà ouverte, la focus
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url.includes(self.registration.scope) && 'focus' in client) {
            return client.focus();
          }
        }
        // Sinon, ouvrir une nouvelle fenêtre
        if (clients.openWindow) {
          const urlToOpen = event.notification.data?.url || self.registration.scope;
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// Gestion des notifications push (pour Firebase Cloud Messaging)
self.addEventListener('push', event => {
  swLog('info', 'Push notification reçue');
  
  let data = {};
  
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    swLog('warn', 'Erreur lors du parsing de la notification push', e);
  }
  
  const title = data.title || 'Poké-TCG';
  const options = {
    body: data.body || 'Vous avez une nouvelle notification',
    icon: data.icon || 'favicon.ico',
    badge: 'favicon.ico',
    tag: data.tag || 'default',
    requireInteraction: false,
    vibrate: [200, 100, 200],
    data: data
  };
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});
