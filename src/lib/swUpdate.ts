/**
 * Service worker update handling.
 *
 * The generated `registerSW.js` only registers the service worker on the
 * window `load` event. An installed PWA is usually resumed rather than fully
 * reloaded, so that event may not fire for days — meaning a new deployment is
 * never even looked for.
 *
 * And even when a new worker does activate (the build uses skipWaiting +
 * clientsClaim), the page that is already open keeps running the JavaScript
 * bundle it loaded originally. The caches update underneath, but the user
 * still sees the old app until something reloads it.
 *
 * This module fixes both halves:
 *   1. Actively check for a new worker — on startup, when the app regains
 *      focus, and periodically while it stays open.
 *   2. Reload once the new worker takes control, so the fresh bundle is
 *      actually executed.
 */

/** How often to check for a new deployment while the app stays open. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function initServiceWorkerUpdates(): void {
  if (!('serviceWorker' in navigator)) return;

  // When a new service worker takes control, the running page is still
  // executing the previous bundle — reload so the new one is used.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Guard against reload loops if several events arrive together.
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  void navigator.serviceWorker.ready.then((registration) => {
    const checkForUpdate = () => {
      // Ignore failures: offline, or the server is briefly unreachable.
      void registration.update().catch(() => undefined);
    };

    // Check straight away — covers a PWA resumed from the background, where
    // the window `load` event does not fire again.
    checkForUpdate();

    // Check whenever the user returns to the app.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    });
    window.addEventListener('focus', checkForUpdate);

    // And periodically, for a session left open for a long time.
    window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
  });
}
