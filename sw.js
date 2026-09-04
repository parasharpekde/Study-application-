// ==========================================================================
// FlowState - Offline PWA Service Worker v2
// Strategies: Cache-First (app shell) + Stale-While-Revalidate (JS/CSS)
//             + Background Sync (offline session queue)
// ==========================================================================

const CACHE_VERSION = 'v2';
const CACHE_NAME = `flowstate-core-${CACHE_VERSION}`;
const SYNC_TAG = 'flowstate-offline-sync';

// ── Static App Shell ───────────────────────────────────────────────────────
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/main.css',
  '/css/timer.css',
  '/css/audio.css',
  '/css/squad.css',
  '/css/analytics.css',
  '/js/app.js',
  '/js/state.js',
  '/js/timer.js',
  '/js/audio-engine.js',
  '/js/task-logger.js',
  '/js/squad-engine.js',
  '/js/analytics-engine.js',
  '/js/supabase-client.js',
  '/js/custom-audio-db.js',
  '/js/offline-sync-manager.js'
];

// ── Google Fonts — runtime-cached on first visit ───────────────────────────
const FONT_CACHE_NAME = `flowstate-fonts-${CACHE_VERSION}`;
const FONT_ORIGINS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// ── Install: pre-cache entire app shell ───────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('⚡ [SW v2] Pre-caching FlowState offline shell…');
        // addAll will fail if any asset fails — use individual adds with catch for resilience
        return Promise.allSettled(
          PRECACHE_ASSETS.map((url) =>
            cache.add(url).catch((err) => {
              console.warn(`[SW v2] Could not pre-cache ${url}:`, err.message);
            })
          )
        );
      })
      .then(() => {
        console.log('✅ [SW v2] App shell cached. Skipping waiting…');
        return self.skipWaiting();
      })
  );
});

// ── Activate: purge old caches and claim all clients immediately ───────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME && name !== FONT_CACHE_NAME) {
            console.log('🧹 [SW v2] Deleting stale cache:', name);
            return caches.delete(name);
          }
        })
      )
    ).then(() => {
      console.log('🚀 [SW v2] Activated — claiming all clients.');
      return self.clients.claim();
    }).then(() => {
      // Notify all open tabs that a new SW version is active
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) =>
          client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION })
        );
      });
    })
  );
});

// ── Fetch: Routing Strategy ────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Google Fonts — Cache-First with font-specific cache
  if (FONT_ORIGINS.includes(url.hostname)) {
    event.respondWith(cacheThenNetworkFonts(request));
    return;
  }

  // 2. External APIs (Supabase, CDN streams) — Network only, never cache
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // 3. App Shell & JS/CSS — Stale-While-Revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// ── Strategy: Stale-While-Revalidate ──────────────────────────────────────
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  // Always kick off network fetch in background to keep cache fresh
  const networkFetch = fetch(request)
    .then((networkResponse) => {
      if (
        networkResponse &&
        networkResponse.status === 200 &&
        (networkResponse.type === 'basic' || networkResponse.type === 'cors')
      ) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => {
      // Offline: if it's a navigation request, serve the SPA shell
      if (request.mode === 'navigate') {
        return cache.match('/index.html');
      }
      return null;
    });

  // Return cache immediately (instant load), or wait for network if no cache
  return cachedResponse || networkFetch;
}

// ── Strategy: Cache-First for Fonts ────────────────────────────────────────
async function cacheThenNetworkFonts(request) {
  const fontCache = await caches.open(FONT_CACHE_NAME);
  const cachedFont = await fontCache.match(request);
  if (cachedFont) return cachedFont;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      fontCache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return new Response('', { status: 503, statusText: 'Font unavailable offline' });
  }
}

// ── Background Sync: fires when browser regains connectivity ───────────────
self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    console.log('🔄 [SW v2] Background Sync triggered:', SYNC_TAG);
    event.waitUntil(triggerSyncInAllClients());
  }
});

// ── Message Bridge: receive commands from the app ──────────────────────────
self.addEventListener('message', (event) => {
  const { type } = event.data || {};

  if (type === 'SKIP_WAITING') {
    // Triggered by the app when user clicks "Update App" in the update banner
    self.skipWaiting();
  }

  if (type === 'REGISTER_SYNC') {
    // App requests a background sync registration
    self.registration.sync
      .register(SYNC_TAG)
      .then(() => console.log('[SW v2] Background sync registered.'))
      .catch((err) => console.warn('[SW v2] Sync registration failed:', err));
  }

  if (type === 'CACHE_PURGE') {
    // Force re-cache of the app shell (called after SW update)
    caches.delete(CACHE_NAME).then(() => {
      console.log('[SW v2] Cache purged on request.');
    });
  }
});

// ── Helper: notify all app tabs to run sync ────────────────────────────────
async function triggerSyncInAllClients() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clients.length === 0) {
    console.log('[SW v2] No active clients found for sync trigger.');
    return;
  }
  clients.forEach((client) => {
    client.postMessage({ type: 'BG_SYNC_TRIGGER' });
  });
}
