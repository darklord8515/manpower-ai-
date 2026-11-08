import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginScreen } from "@/components/auth/LoginScreen";

export const metadata: Metadata = { title: "Sign in · HAMRA AI" };

// Reads the session in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default function LoginPage() {
  // useSearchParams (the "go here after signing in" target) needs a Suspense boundary.
  return (
    <Suspense>
      <LoginScreen />
    </Suspense>
  );
}
