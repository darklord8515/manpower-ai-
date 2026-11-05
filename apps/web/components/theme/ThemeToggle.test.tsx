import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY, ThemeToggle } from "./ThemeToggle";

function mockOsTheme(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("dark") ? dark : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe("ThemeToggle", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("switches an OS-light page to dark and remembers the choice", async () => {
    mockOsTheme(false);
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole("button", { name: /light and dark/i }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("switches an OS-dark page to light", async () => {
    mockOsTheme(true);
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole("button", { name: /light and dark/i }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("toggles back and forth from an explicit theme", async () => {
    mockOsTheme(false);
    document.documentElement.setAttribute("data-theme", "dark");
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: /light and dark/i });
    await userEvent.click(button);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    await userEvent.click(button);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("still switches when storage is blocked", async () => {
    mockOsTheme(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole("button", { name: /light and dark/i }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    vi.restoreAllMocks();
  });

  it("is reachable and operable by keyboard", async () => {
    mockOsTheme(false);
    render(<ThemeToggle />);
    await userEvent.tab();
    expect(screen.getByRole("button", { name: /light and dark/i })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });
});
