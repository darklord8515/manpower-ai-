"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { Menu as MenuIcon, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { PageTransition } from "@/components/motion/PageTransition";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { navFor, visibleNav } from "./nav";
import { SidebarContent } from "./Sidebar";
import { UserMenu } from "./UserMenu";

const COLLAPSE_KEY = "cq.sidebar";
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "collapsed";
  } catch {
    return false; // Storage blocked (or no browser yet): start expanded.
  }
}

const ICON_BUTTON =
  "press grid size-8 place-items-center rounded-control text-muted transition-[transform,background-color,color] duration-120 hover:bg-hover hover:text-fg";

function Loading() {
  return (
    <div className="grid min-h-screen place-items-center bg-bg p-6">
      <div className="w-full max-w-sm">
        <SkeletonLoader label="Opening CONSTRUCTIQ" count={3} />
      </div>
    </div>
  );
}

/** The signed-in app: black sidebar, top bar, page area. Visitors who are not signed in never see it. */
export function AppShell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { status, user } = auth;
  const router = useRouter();
  const pathname = usePathname();
  // Safe to read the saved choice here: the shell only renders after sign-in is known, in the browser.
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawer, setDrawer] = useState(false);

  // The proxy already sends visitors without a cookie to the sign-in page; this covers a cookie the API rejects.
  useEffect(() => {
    if (auth.status !== "anonymous") return;
    const query = new URLSearchParams();
    if (auth.reason) query.set("reason", auth.reason);
    if (pathname !== "/" && auth.reason !== "signed-out") query.set("next", pathname);
    router.replace(`/login${query.size ? `?${query}` : ""}`);
  }, [auth, pathname, router]);

  if (status !== "signed-in" || !user) return <Loading />;

  const items = visibleNav(user.permissions);
  const page = navFor(pathname);

  function toggleCollapsed() {
    setCollapsed((value) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, value ? "expanded" : "collapsed");
      } catch {
        // Storage blocked: the choice lasts for this visit.
      }
      return !value;
    });
  }

  return (
    <div className="min-h-screen bg-bg md:grid md:grid-cols-[auto_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-100 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <aside
        className="sticky top-0 hidden h-screen shrink-0 overflow-hidden transition-[width] duration-180 ease-out md:block"
        style={{ width: collapsed ? "var(--sidebar-collapsed)" : "var(--sidebar-w)" }}
      >
        <SidebarContent items={items} collapsed={collapsed} />
      </aside>

      <Dialog.Root open={drawer} onOpenChange={setDrawer}>
        <AnimatePresence>
          {drawer && (
            <Dialog.Portal forceMount>
              <Dialog.Overlay asChild forceMount>
                <motion.div
                  className="fixed inset-0 z-70 bg-(--scrim) md:hidden"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                />
              </Dialog.Overlay>
              <Dialog.Content asChild forceMount aria-describedby={undefined}>
                <motion.div
                  className="fixed inset-y-0 left-0 z-80 w-70 max-w-[85vw] md:hidden"
                  initial={{ x: -24, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -24, opacity: 0 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                >
                  <Dialog.Title className="sr-only">Menu</Dialog.Title>
                  <SidebarContent items={items} onNavigate={() => setDrawer(false)} />
                </motion.div>
              </Dialog.Content>
            </Dialog.Portal>
          )}
        </AnimatePresence>
      </Dialog.Root>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-bg/95 px-4 backdrop-blur-sm md:px-6">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            className={`${ICON_BUTTON} md:hidden`}
            aria-label="Open menu"
          >
            <MenuIcon className="size-4.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            className={`${ICON_BUTTON} hidden md:grid`}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4.5" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="size-4.5" aria-hidden="true" />
            )}
          </button>
          <p className="min-w-0 truncate text-sm text-muted">
            {page ? (
              <>
                {page.group || "Dashboards"} <span aria-hidden="true">/</span>{" "}
                <span className="font-medium text-fg">{page.label}</span>
              </>
            ) : (
              "CONSTRUCTIQ"
            )}
          </p>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-360 flex-1 px-4 py-6 md:px-6">
          <PageTransition transitionKey={pathname}>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
