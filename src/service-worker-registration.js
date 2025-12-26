// src/service-worker-registration.js
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('/service-worker.js');
      console.log('Service Worker registered');
    } catch (err) {
      console.error('Service Worker registration failed', err);
    }
  });
}
