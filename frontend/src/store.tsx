// App-wide state: session capabilities, master data, language, theme, sync
// status, and the derived cascades the New Card form depends on.
//
// One provider rather than a state library — the app has a single user, a single
// document type, and no cross-screen mutation to coordinate.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, boot, fetchCapabilities, fetchMasters } from './api';
import { KEY_CAPS, KEY_MASTERS, sync } from './sync';
import { kvGet, kvSet } from './db';
import { translate, type Lang, type T } from './i18n';
import { DENY_ALL, type Capabilities, type Masters, type SyncState } from './types';
import type { Option } from './components/Picker';

export type ThemeChoice = 'light' | 'dark' | 'system';

interface Store {
  ready: boolean;
  /** Set when the server says we have no session. The shell page is static (no
   *  Python controller, which is what lets it live at a pretty URL with no
   *  worker restart), so it cannot bounce a Guest to /login — the app does. */
  needsLogin: boolean;
  caps: Capabilities;
  masters: Masters | null;
  /** True when masters came from cache and no server copy has arrived yet. */
  mastersStale: boolean;
  syncState: SyncState;

  lang: Lang;
  setLang: (lang: Lang) => void;
  t: T;

  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;

  /** Re-pull masters + capabilities. Resolves true if masters actually moved. */
  refresh: () => Promise<boolean>;

  build: string | number;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside <StoreProvider>');
  return store;
}

const LANG_KEY = 'plm.lang';
const THEME_KEY = 'plm.theme';

function readLang(): Lang {
  const stored = localStorage.getItem(LANG_KEY);
  if (stored === 'en' || stored === 'hi') return stored;
  // Default to Hindi only when the device is set to it — an English phone
  // belongs to the office, a Hindi phone to the site.
  return navigator.language?.toLowerCase().startsWith('hi') ? 'hi' : 'en';
}

function readTheme(): ThemeChoice {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

function applyTheme(choice: ThemeChoice): void {
  const dark =
    choice === 'dark' ||
    (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');

  // Keep the Android status bar tinted to match the app chrome.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#11151E' : '#FFFFFF');
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [caps, setCaps] = useState<Capabilities>(DENY_ALL);
  const [masters, setMasters] = useState<Masters | null>(null);
  const [mastersStale, setMastersStale] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>(sync.getState());
  const [lang, setLangState] = useState<Lang>(readLang);
  const [theme, setThemeState] = useState<ThemeChoice>(readTheme);

  const t = useMemo<T>(() => (key, vars) => translate(lang, key, vars), [lang]);

  const setLang = useCallback((next: Lang) => {
    localStorage.setItem(LANG_KEY, next);
    setLangState(next);
  }, []);

  const setTheme = useCallback((next: ThemeChoice) => {
    localStorage.setItem(THEME_KEY, next);
    setThemeState(next);
    applyTheme(next);
  }, []);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);

  /** Cache-first boot: show the last known data immediately, then reconcile with
   *  the server. On a slow site connection this is the difference between an
   *  instant app and a ten-second spinner. */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [cachedCaps, cachedMasters] = await Promise.all([
        kvGet<Capabilities>(KEY_CAPS),
        kvGet<Masters>(KEY_MASTERS),
      ]);

      if (cancelled) return;
      if (cachedCaps) setCaps(cachedCaps);
      if (cachedMasters) {
        setMasters(cachedMasters);
        setMastersStale(true);
      }
      setReady(true);

      try {
        const freshCaps = await fetchCapabilities();
        if (cancelled) return;
        setCaps(freshCaps);
        setNeedsLogin(false);
        await kvSet(KEY_CAPS, freshCaps);
      } catch (error) {
        if (cancelled) return;
        // A dead session must be distinguished from no signal: one needs the
        // login page, the other needs the cached data we already loaded.
        if (
          error instanceof ApiError &&
          (error.kind === 'auth' || error.kind === 'permission')
        ) {
          setNeedsLogin(true);
        }
      }

      try {
        const freshMasters = await fetchMasters();
        if (cancelled) return;
        setMasters(freshMasters);
        setMastersStale(false);
        await kvSet(KEY_MASTERS, freshMasters);
      } catch {
        /* offline — cached masters stand */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = sync.subscribe(setSyncState);
    void sync.start();
    return () => {
      unsubscribe();
      sync.stop();
    };
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    const previousRev = masters?.rev;
    const fresh = await fetchMasters();
    setMasters(fresh);
    setMastersStale(false);
    await kvSet(KEY_MASTERS, fresh);

    try {
      const freshCaps = await fetchCapabilities();
      setCaps(freshCaps);
      await kvSet(KEY_CAPS, freshCaps);
    } catch {
      /* capabilities are secondary here */
    }

    return fresh.rev !== previousRev;
  }, [masters?.rev]);

  const value = useMemo<Store>(
    () => ({
      ready,
      needsLogin,
      caps,
      masters,
      mastersStale,
      syncState,
      lang,
      setLang,
      t,
      theme,
      setTheme,
      refresh,
      build: boot.build,
    }),
    [
      ready,
      needsLogin,
      caps,
      masters,
      mastersStale,
      syncState,
      lang,
      setLang,
      t,
      theme,
      setTheme,
      refresh,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

// ------------------------------------------------------- master → options

/**
 * The New Card cascade.
 *
 * Real link fields on this site, verified against live meta:
 *   Zone Details.town_project             -> Site Project
 *   Pipe Laying Village Details.townproject -> Site Project
 *   Pipe Laying Village Details.zone_name   -> Zone Details
 *   Component at Site.project            -> Site Project
 *   Contractor at Site.project           -> Site Project
 *
 * The desk client scripts disagree with each other on these names (one filters
 * zones by `project_name`, another by `town_project`), which is why they are
 * resolved here from the schema rather than copied.
 *
 * Villages are scoped by project, then narrowed by zone ONLY for villages that
 * actually record one. Most rows on this site have `zone_name` empty, so a
 * strict zone filter would show an empty list and block the form — those
 * unassigned villages stay visible and are marked as such.
 */
export function useCascade(masters: Masters | null) {
  return useMemo(() => {
    const projects: Option[] = (masters?.projects ?? []).map((project) => ({
      value: project.name,
    }));

    const zonesFor = (project: string | null): Option[] =>
      !project
        ? []
        : (masters?.zones ?? [])
            .filter((zone) => zone.project === project)
            .map((zone) => ({ value: zone.name }));

    const villagesFor = (project: string | null, zone: string | null): Option[] => {
      if (!project) return [];
      const inProject = (masters?.villages ?? []).filter(
        (village) => village.project === project,
      );

      if (!zone) {
        return inProject.map((village) => ({
          value: village.name,
          meta: village.zone ?? undefined,
        }));
      }

      const matching = inProject.filter((village) => village.zone === zone);
      const unassigned = inProject.filter((village) => !village.zone);

      return [
        ...matching.map((village) => ({ value: village.name, group: zone })),
        ...unassigned.map((village) => ({
          value: village.name,
          group: 'Not linked to a zone',
        })),
      ];
    };

    const componentsFor = (project: string | null): Option[] =>
      !project
        ? []
        : (masters?.components ?? [])
            .filter((component) => component.project === project)
            .map((component) => ({ value: component.name }));

    const contractorsFor = (project: string | null): Option[] =>
      !project
        ? []
        : (masters?.contractors ?? [])
            .filter((contractor) => contractor.project === project)
            .map((contractor) => ({
              value: contractor.name,
              meta: contractor.contractor ?? undefined,
            }));

    // Items are grouped by item_group so DI / HDPE / MDPE read as sections.
    const pipeItems: Option[] = (masters?.pipe_items ?? []).map((item) => ({
      value: item.name,
      label: item.name,
      meta: item.item_name !== item.name ? (item.item_name ?? undefined) : undefined,
      tag: item.stock_uom ?? undefined,
      group: item.item_group ?? undefined,
    }));

    const accItems: Option[] = (masters?.acc_items ?? []).map((item) => ({
      value: item.name,
      label: item.name,
      meta: item.item_name !== item.name ? (item.item_name ?? undefined) : undefined,
      tag: item.stock_uom ?? undefined,
      group: item.item_group ?? undefined,
    }));

    return {
      projects,
      zonesFor,
      villagesFor,
      componentsFor,
      contractorsFor,
      pipeItems,
      accItems,
    };
  }, [masters]);
}

/** Strata options — copied from the Select field's own options on
 *  Pipe Laying Detail Child, so they stay in step with the doctype. */
export const STRATA_OPTIONS: Option[] = [
  { value: 'Hard Rock' },
  { value: 'Soft Rock' },
  { value: 'Laal Mitti' },
  { value: 'Kali Mitti' },
];
