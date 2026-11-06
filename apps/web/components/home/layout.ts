/**
 * The widgets a Home can hold, and the rules for the layout a person ends up with.
 *
 * We ship one default layout per kind of Home (HR, MD/CEO). A person may reorder and hide widgets;
 * only their changes are saved. A widget added in a later release appears at the end of their
 * layout without disturbing what they arranged. The KPI tiles above the widgets are fixed.
 */
export type WidgetId =
  | "expiry"
  | "workforce"
  | "due"
  | "projects_chart"
  | "projects_table"
  | "leaving"
  | "pipeline"
  | "by_trade"
  | "unavailable";

export type HomeKind = "hr" | "executive";

export type WidgetInfo = {
  title: string;
  /** What it shows, for the tray of hidden widgets. */
  about: string;
  /** Columns it takes on a wide screen (of 3). On a phone every widget is full width. */
  span: 1 | 2 | 3;
  kinds: HomeKind[];
};

export const WIDGETS: Record<WidgetId, WidgetInfo> = {
  expiry: {
    title: "Documents running out",
    about: "How many documents expire each week",
    span: 2,
    kinds: ["hr"],
  },
  workforce: {
    title: "Where everyone is",
    about: "On a project, mobilizing, available, not available",
    span: 1,
    kinds: ["hr", "executive"],
  },
  due: {
    title: "Documents to deal with first",
    about: "The five documents that need action soonest",
    span: 2,
    kinds: ["hr"],
  },
  projects_chart: {
    title: "Projects: planned and deployed",
    about: "People on site against the plan, per project",
    span: 1,
    kinds: ["hr", "executive"],
  },
  projects_table: {
    title: "Projects",
    about: "Every project with its staffing",
    span: 3,
    kinds: ["executive"],
  },
  by_trade: {
    title: "People by trade",
    about: "Where each trade's people are",
    span: 2,
    kinds: ["hr", "executive"],
  },
  unavailable: {
    title: "People not available",
    about: "Who is on leave or medical",
    span: 1,
    kinds: ["hr"],
  },
  leaving: {
    title: "Leaving soon",
    about: "Exits and contract ends with nobody to replace them",
    span: 2,
    kinds: ["hr", "executive"],
  },
  pipeline: {
    title: "Recruitment pipeline",
    about: "People on the way, by stage, and who arrives late",
    span: 1,
    kinds: ["hr", "executive"],
  },
};

export const DEFAULT_ORDER: Record<HomeKind, WidgetId[]> = {
  hr: [
    "expiry",
    "workforce",
    "due",
    "projects_chart",
    "by_trade",
    "unavailable",
    "leaving",
    "pipeline",
  ],
  executive: ["projects_chart", "workforce", "projects_table", "pipeline", "leaving", "by_trade"],
};

/** Hidden until someone asks for them, so the first Home is not crowded. */
export const DEFAULT_HIDDEN: Record<HomeKind, WidgetId[]> = {
  hr: [],
  executive: ["by_trade"],
};

export type Layout = { order: WidgetId[]; hidden: WidgetId[] };

/** What the API stores (ids as plain text, because the server only checks they are known). */
export type SavedLayout = { order: string[]; hidden: string[] };

const isWidget = (id: string): id is WidgetId => id in WIDGETS;
const allowed = (id: string, kind: HomeKind): id is WidgetId =>
  isWidget(id) && WIDGETS[id].kinds.includes(kind);

export function defaultLayout(kind: HomeKind): Layout {
  return { order: [...DEFAULT_ORDER[kind]], hidden: [...DEFAULT_HIDDEN[kind]] };
}

/**
 * The layout to show: the person's saved one, made safe. Unknown widgets and widgets this kind of
 * Home cannot hold are dropped; widgets they have never seen come in at the end, hidden if they
 * are hidden by default.
 */
export function resolveLayout(kind: HomeKind, saved: SavedLayout | null | undefined): Layout {
  if (!saved) return defaultLayout(kind);
  const order: WidgetId[] = [];
  for (const id of saved.order) if (allowed(id, kind) && !order.includes(id)) order.push(id);
  const unseen = DEFAULT_ORDER[kind].filter((id) => !order.includes(id));
  const hidden = new Set<WidgetId>(saved.hidden.filter((id): id is WidgetId => allowed(id, kind)));
  for (const id of unseen) {
    order.push(id);
    if (DEFAULT_HIDDEN[kind].includes(id)) hidden.add(id);
  }
  return { order, hidden: order.filter((id) => hidden.has(id)) };
}

export const visibleWidgets = (layout: Layout): WidgetId[] =>
  layout.order.filter((id) => !layout.hidden.includes(id));

export function isDefaultLayout(kind: HomeKind, layout: Layout): boolean {
  const fallback = defaultLayout(kind);
  return (
    layout.order.join() === fallback.order.join() &&
    [...layout.hidden].sort().join() === [...fallback.hidden].sort().join()
  );
}

export function hide(layout: Layout, id: WidgetId): Layout {
  return layout.hidden.includes(id) ? layout : { ...layout, hidden: [...layout.hidden, id] };
}

/** Bring a hidden widget back at the end of the visible ones. */
export function show(layout: Layout, id: WidgetId): Layout {
  if (!layout.hidden.includes(id)) return layout;
  return {
    order: [...layout.order.filter((w) => w !== id), id],
    hidden: layout.hidden.filter((w) => w !== id),
  };
}

/** Move `id` to where `over` is, among the visible widgets (hidden ones keep their place). */
export function move(layout: Layout, id: WidgetId, over: WidgetId): Layout {
  const from = layout.order.indexOf(id);
  const to = layout.order.indexOf(over);
  if (from < 0 || to < 0 || from === to) return layout;
  const order = [...layout.order];
  order.splice(from, 1);
  order.splice(to, 0, id);
  return { ...layout, order };
}

export const toSaved = (layout: Layout): SavedLayout => ({
  order: layout.order,
  hidden: layout.hidden,
});

export const SPAN_CLASS: Record<1 | 2 | 3, string> = {
  1: "",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
};
