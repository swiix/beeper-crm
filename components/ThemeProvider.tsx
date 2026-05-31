"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getColorTheme, setColorTheme, type ColorTheme } from "@/lib/settings";

function applyThemeToDocument(theme: ColorTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

const ThemeContext = createContext<{
  theme: ColorTheme;
  setTheme: (t: ColorTheme) => void;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ColorTheme>(() =>
    typeof window !== "undefined" ? getColorTheme() : "light"
  );

  useEffect(() => {
    const t = getColorTheme();
    setThemeState(t);
    applyThemeToDocument(t);
  }, []);

  const setTheme = useCallback((t: ColorTheme) => {
    setColorTheme(t);
    setThemeState(t);
    applyThemeToDocument(t);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): { theme: ColorTheme; setTheme: (t: ColorTheme) => void } {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
