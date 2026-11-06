"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { isDefaultLayout, resolveLayout, toSaved, type HomeKind, type Layout } from "./layout";

type State =
  | { status: "loading" }
  /** The saved layout could not be read: the default is shown, and saving still works. */
  | { status: "unreadable"; layout: Layout }
  | { status: "ready"; layout: Layout };

/**
 * The layout this person sees, and how to save a new one. The default is used until their saved
 * layout arrives; if it cannot be read the default is used and they are told, not blocked.
 */
export function useHomeLayout(kind: HomeKind) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    api
      .preferences()
      .then((p) => !cancelled && setState({ status: "ready", layout: resolveLayout(kind, p.home) }))
      .catch(
        () => !cancelled && setState({ status: "unreadable", layout: resolveLayout(kind, null) }),
      );
    return () => {
      cancelled = true;
    };
  }, [kind]);

  /** Saves the layout (the default is stored as "nothing", so a better default reaches everyone). */
  const save = useCallback(
    async (layout: Layout): Promise<string | null> => {
      try {
        await api.savePreferences({ home: isDefaultLayout(kind, layout) ? null : toSaved(layout) });
        setState({ status: "ready", layout });
        return null;
      } catch (error) {
        return error instanceof ApiError ? error.message : "Couldn’t save your layout. Try again.";
      }
    },
    [kind],
  );

  return {
    status: state.status,
    layout: state.status === "loading" ? resolveLayout(kind, null) : state.layout,
    save,
  };
}
