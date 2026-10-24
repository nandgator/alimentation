/** Registers the service worker that keeps the app and the last statement available offline. */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((reg) => {
      // A new version waits until the pages using the old one are closed; ask it to take over
      // the next time the person opens the app rather than interrupting them.
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        next?.addEventListener('statechange', () => {
          if (next.state === 'installed' && navigator.serviceWorker.controller)
            next.postMessage({ type: 'SKIP_WAITING' });
        });
      });
    });
  });
}

/** What was kept on this device for offline reading is removed when someone signs out. */
export async function forgetThisDevice(): Promise<void> {
  try {
    await caches.delete('last-seen-v1');
  } catch {
    // No cache storage here; nothing was kept.
  }
}
