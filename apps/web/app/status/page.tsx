import { AlhamraMark } from "@/components/brand/Logo";
import { ApiStatus } from "@/components/status/ApiStatus";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

// Same-origin: the web app forwards /api/* to the API (see next.config.ts).

export default function StatusPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-360 flex-col px-4 md:px-6">
      <header className="flex h-14 items-center gap-3 border-b border-border">
        <AlhamraMark className="h-8 w-7 text-fg" label="Alhamra" />
        <span className="text-sm font-semibold tracking-[0.04em]">HAMRA AI</span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <main id="main" className="flex flex-1 flex-col gap-4 py-6">
        <div>
          <h1 className="text-xl font-semibold leading-8">System status</h1>
          <p className="text-sm text-muted">
            The platform is under construction. This page checks that the pieces connect.
          </p>
        </div>
        <div className="max-w-xl">
          <ApiStatus baseUrl="/api" />
        </div>
      </main>

      <footer className="border-t border-border py-4 text-xs text-subtle">
        Fictional demo data only. Alhamra Construction &amp; Development.
      </footer>
    </div>
  );
}
