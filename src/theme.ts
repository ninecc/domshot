import type { ThemePreference, UiTheme } from './types';

export const THEME_STORAGE_KEY = 'uiTheme';

export function isUiTheme(value: unknown): value is UiTheme {
  return value === 'light' || value === 'dark';
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'auto' || isUiTheme(value);
}

export function systemPrefersDark(): boolean {
  try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; }
}

export function resolveTheme(preference: ThemePreference, prefersDark = systemPrefersDark()): UiTheme {
  return isUiTheme(preference) ? preference : prefersDark ? 'dark' : 'light';
}

export function applyDocumentTheme(theme: UiTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export async function loadThemePreference(): Promise<ThemePreference> {
  try {
    const stored = await chrome.storage?.sync?.get(THEME_STORAGE_KEY);
    return isThemePreference(stored?.[THEME_STORAGE_KEY]) ? stored[THEME_STORAGE_KEY] : 'auto';
  } catch { return 'auto'; }
}

export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  try { await chrome.storage?.sync?.set({ [THEME_STORAGE_KEY]: preference }); } catch { /* Storage is unavailable on standalone test pages. */ }
}
