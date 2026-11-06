/**
 * "This project was just added" travels from the Add-project sheet to the forecast screen through
 * session storage: it is set before the page changes, so the next screen always sees it. Storage can
 * be blocked (private windows); then the banner is simply not shown.
 */
const KEY = "cq.justAdded";

export function rememberAdded(code: string): void {
  try {
    window.sessionStorage.setItem(KEY, code);
  } catch {
    /* blocked: no banner */
  }
}

export function wasJustAdded(code: string): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === code;
  } catch {
    return false;
  }
}

export function forgetAdded(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to forget */
  }
}
