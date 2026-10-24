/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope;

// The app itself: every file it is made of, kept for offline use.
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Pages open the app shell, which routes itself. The API and sign-in are never answered with it.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/auth\//, /^\/_migrate\//],
  }),
);

/**
 * The last statement. Reading a workspace goes to the network first; if that fails the copy
 * saved on this device is used and marked, so the page can say so. Only what a person has
 * already looked at is kept, and it is cleared when they sign out (see session.tsx).
 */
export const LAST_SEEN = 'last-seen-v1';
const readable = /^\/api\/(me|w\/[^/]+\/(bootstrap|statements|ledger|claims|log))$/;

registerRoute(
  ({ url, request }) => request.method === 'GET' && readable.test(url.pathname),
  new NetworkFirst({
    cacheName: LAST_SEEN,
    networkTimeoutSeconds: 6,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 60 * 24 * 3600,
        purgeOnQuotaError: true,
      }),
      {
        // Mark a copy served from the device, and say when it was saved.
        cachedResponseWillBeUsed: async ({ cachedResponse }) => {
          if (!cachedResponse) return cachedResponse;
          const headers = new Headers(cachedResponse.headers);
          headers.set('x-from-device', '1');
          return new Response(cachedResponse.body, { status: cachedResponse.status, headers });
        },
        cacheWillUpdate: async ({ response }) => (response.status === 200 ? response : null),
      },
    ],
  }),
);

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
clientsClaim();
