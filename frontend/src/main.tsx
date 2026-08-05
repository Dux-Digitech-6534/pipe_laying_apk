import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StoreProvider } from './store';
import './styles.css';

// Register the app-shell service worker so the app OPENS with no connection.
//
// The script is served from the site root (so it MAY claim a scope above its own
// directory) but is registered narrowly at /pipe-laying/ — a root-scoped worker
// would collide with other apps on this bench that register their own.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/plm-sw.js', { scope: '/pipe-laying/' })
      .catch(() => {
        /* a missing worker only costs offline cold start, not function */
      });
  });
}

const container = document.getElementById('plm-root');
if (!container) throw new Error('#plm-root missing');

createRoot(container).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);
