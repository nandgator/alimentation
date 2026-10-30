import { useSyncExternalStore } from 'react';

/**
 * The colour theme: the system's setting unless the person has chosen. One choice, kept under one key, that
 * every page answers to: the app, the home page, the guides and the docs. `public/theme.js` applies it before
 * the first paint so nothing flashes; this file is the control's side of it.
 */
export type Theme = 'auto' | 'light' | 'dark';

export const THEMES: readonly Theme[] = ['auto', 'light', 'dark'];
export const THEME_LABEL: Record<Theme, string> = { auto: 'Auto', light: 'Light', dark: 'Dark' };

declare global {
  interface Window {
    /** Makes a change of theme as a dissolve where the browser can (defined by `public/theme.js`). */
    fadeTheme?: (apply: () => void) => void;
  }
}

const KEY = 'theme';
/** The key the documentation used before the choice was shared; read once, then dropped. */
const LEGACY_KEY = 'docs-theme';

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    // Storage can be unavailable (private windows, blocked site data): what this page shows is the truth.
    const t = document.documentElement.dataset.theme;
    return t === 'light' || t === 'dark' ? t : 'auto';
  }
}

/** Shows a theme now. With "auto" the attribute goes, and the stylesheet answers to the system again. */
export function showTheme(t: Theme): void {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

export function setTheme(t: Theme): void {
  try {
    localStorage.removeItem(LEGACY_KEY);
    if (t === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    // The choice lasts for this page only.
  }
  // The control answers at once; the theme follows as a dissolve, where the browser can.
  notify();
  if (window.fadeTheme) window.fadeTheme(() => showTheme(t));
  else showTheme(t);
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab changed it: follow.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) {
      showTheme(readTheme());
      onChange();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, readTheme, () => 'auto' as Theme);
  return [theme, setTheme];
}
