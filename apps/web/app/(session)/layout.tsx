import { AuthProvider } from "@/components/auth/AuthProvider";

/**
 * Everything behind sign-in is personal data that depends on who is signed in, so none of it is
 * built ahead of time or cached on the server: the pages load their data in the browser, from the
 * API, after the session is checked. That is deliberate, so the "instant navigation" hints that
 * Next shows in development do not apply here.
 */
export const instant = false;

/** The sign-in page and the app share one session state. */
export default function SessionLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
