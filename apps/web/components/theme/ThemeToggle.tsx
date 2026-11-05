"use client";

import { Moon, Sun } from "lucide-react";

export const THEME_STORAGE_KEY = "cq.theme";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be blocked (private window). The choice then lasts for this visit only.
  }
}

/**
 * Switches light and dark. Both icons are always rendered and CSS shows the right one from
 * data-theme / the OS setting, so there is no state to hydrate and no flash.
 */
export function ThemeToggle() {
  return (
    <button
      type="button"
      onClick={() => applyTheme(currentTheme() === "dark" ? "light" : "dark")}
      className="relative inline-grid size-8 place-items-center rounded-control border border-transparent text-muted transition-colors hover:bg-hover hover:text-fg"
      aria-label="Switch between light and dark theme"
    >
      <Moon className="theme-icon-moon size-4.5" aria-hidden="true" />
      <Sun className="theme-icon-sun size-4.5" aria-hidden="true" />
    </button>
  );
}
