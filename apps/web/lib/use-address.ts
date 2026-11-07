"use client";

import { useSearchParams } from "next/navigation";

/**
 * The query string of the page being shown, for a screen that reads `?alert=…`, `?worker=…` and
 * the like once, when it opens.
 *
 * `window.location` cannot be used for this while rendering: on a client-side navigation (a link
 * inside the app) the browser's address is still the previous page's until the new page has
 * rendered, so a screen opened from a link would miss everything the link carried. The router
 * already knows the new address. Without a router (unit tests) it falls back to the window.
 */
export function useAddress(): string {
  const params = useSearchParams();
  if (params) return params.toString();
  return typeof window === "undefined" ? "" : window.location.search;
}
