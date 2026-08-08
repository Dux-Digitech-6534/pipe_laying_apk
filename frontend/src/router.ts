// Hash-based routing.
//
// Hash rather than path segments on purpose: the SPA is served by Frappe at
// /pipe-laying (and /pipe-laying/m for the APK), and a hash keeps every deep
// link inside one server route — no extra website_route_rules, no 404 when a
// user reloads on a detail screen, and it works identically inside the WebView.
//
// Back is wired to real history, so Android's hardware Back walks the screen
// stack the way it does in a native app.

import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'cards'; status?: string }
  | { name: 'card'; id: string }
  | { name: 'new' }
  | { name: 'transfer' }
  | { name: 'laying'; id: string }
  | { name: 'edit-laying'; id: string; pipeId: string }
  | { name: 'backfill'; id: string }
  | { name: 'sync' }
  | { name: 'settings' };

export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '');
  const parts = clean.split('/');
  const [head, tail] = parts;

  switch (head) {
    case 'edit-laying':
      return parts[1] && parts[2]
        ? {
            name: 'edit-laying',
            id: decodeURIComponent(parts[1]),
            pipeId: decodeURIComponent(parts[2]),
          }
        : { name: 'cards' };
    case '':
    case 'home':
      return { name: 'home' };
    case 'cards':
      return { name: 'cards', status: tail || undefined };
    case 'card':
      return tail ? { name: 'card', id: decodeURIComponent(tail) } : { name: 'cards' };
    case 'new':
      return { name: 'new' };
    case 'transfer':
      return { name: 'transfer' };
    case 'laying':
      return tail ? { name: 'laying', id: decodeURIComponent(tail) } : { name: 'cards' };
    case 'backfill':
      return tail ? { name: 'backfill', id: decodeURIComponent(tail) } : { name: 'cards' };
    case 'sync':
      return { name: 'sync' };
    case 'settings':
      return { name: 'settings' };
    default:
      return { name: 'home' };
  }
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/home';
    case 'cards':
      return route.status ? `#/cards/${route.status}` : '#/cards';
    case 'card':
      return `#/card/${encodeURIComponent(route.id)}`;
    case 'new':
      return '#/new';
    case 'transfer':
      return '#/transfer';
    case 'laying':
      return `#/laying/${encodeURIComponent(route.id)}`;
    case 'edit-laying':
      return `#/edit-laying/${encodeURIComponent(route.id)}/${encodeURIComponent(route.pipeId)}`;
    case 'backfill':
      return `#/backfill/${encodeURIComponent(route.id)}`;
    case 'sync':
      return '#/sync';
    case 'settings':
      return '#/settings';
  }
}

/** The five bottom-tab destinations. Anything else is a pushed screen with a
 *  back arrow instead of a highlighted tab. */
const TABS = new Set(['home', 'cards', 'new', 'sync', 'settings']);

export function isTabRoute(route: Route): boolean {
  return TABS.has(route.name);
}

export function navigate(route: Route): void {
  const hash = routeToHash(route);
  if (location.hash === hash) return;
  location.hash = hash;
}

/** Replace rather than push — for redirects that shouldn't be re-enterable by
 *  pressing Back (e.g. bouncing off a screen the user can't access). */
export function replace(route: Route): void {
  history.replaceState(null, '', routeToHash(route));
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function goBack(fallback: Route = { name: 'home' }): void {
  // history.length is 1 on a cold deep link, where Back would exit the app.
  if (history.length > 1) {
    history.back();
  } else {
    replace(fallback);
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}
