'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_THEME,
  isThemeId,
  THEME_OPTIONS,
  THEME_STORAGE_KEY,
  type ThemeId,
  type ThemeOption,
} from '@/lib/themes';

interface ThemeContextValue {
  theme: ThemeId;
  ready: boolean;
  themes: readonly ThemeOption[];
  setTheme: (themeId: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(themeId: ThemeId): void {
  document.documentElement.setAttribute('data-theme', themeId);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(DEFAULT_THEME);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      const initialTheme = isThemeId(storedTheme) ? storedTheme : DEFAULT_THEME;
      setThemeState(initialTheme);
      applyTheme(initialTheme);
    } catch {
      applyTheme(DEFAULT_THEME);
    } finally {
      setReady(true);
    }
  }, []);

  const setTheme = useCallback((themeId: ThemeId) => {
    setThemeState(themeId);
    applyTheme(themeId);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeId);
    } catch {
      // Ignore storage errors in private/incognito contexts.
    }
  }, []);

  const value = useMemo(
    () => ({
      theme,
      ready,
      themes: THEME_OPTIONS,
      setTheme,
    }),
    [ready, setTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
