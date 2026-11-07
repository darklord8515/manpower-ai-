import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORDER,
  defaultLayout,
  hide,
  isDefaultLayout,
  move,
  resolveLayout,
  show,
  toSaved,
  visibleWidgets,
  WIDGETS,
  type WidgetId,
} from "./layout";

describe("the default layouts", () => {
  it("only hold widgets that kind of Home may show, each once", () => {
    for (const kind of ["hr", "executive"] as const) {
      const order = DEFAULT_ORDER[kind];
      expect(new Set(order).size).toBe(order.length);
      for (const id of order) expect(WIDGETS[id].kinds).toContain(kind);
    }
  });

  it("start with the MD's by-trade widget hidden, and nothing hidden for HR", () => {
    expect(defaultLayout("executive").hidden).toEqual(["by_trade"]);
    expect(defaultLayout("hr").hidden).toEqual([]);
    expect(visibleWidgets(defaultLayout("executive"))).not.toContain("by_trade");
  });
});

describe("resolveLayout", () => {
  it("is the default when nothing is saved", () => {
    expect(resolveLayout("hr", null)).toEqual(defaultLayout("hr"));
    expect(resolveLayout("hr", undefined)).toEqual(defaultLayout("hr"));
  });

  it("keeps the person's order and hidden widgets", () => {
    const layout = resolveLayout("hr", {
      order: ["leaving", "expiry", "workforce"],
      hidden: ["due"],
    });
    expect(layout.order.slice(0, 3)).toEqual(["leaving", "expiry", "workforce"]);
    expect(layout.hidden).toEqual(["due"]);
  });

  it("adds widgets the person has never seen at the end", () => {
    const layout = resolveLayout("hr", { order: ["expiry", "workforce"], hidden: [] });
    const unseen = DEFAULT_ORDER.hr.filter((id) => id !== "expiry" && id !== "workforce");
    expect(layout.order).toEqual(["expiry", "workforce", ...unseen]);
    expect(layout.hidden).toEqual([]);
  });

  it("puts the Action Center at the end for someone who arranged their Home before it existed", () => {
    const layout = resolveLayout("hr", { order: ["workforce", "expiry"], hidden: ["due"] });
    expect(layout.order.at(0)).toBe("workforce");
    expect(layout.order).toContain("action_center");
    expect(layout.order.indexOf("action_center")).toBeGreaterThan(layout.order.indexOf("expiry"));
    expect(layout.hidden).toEqual(["due"]); // what they hid stays hidden
  });

  it("starts the HR Home with the Action Center and the MD/CEO Home with the alert counts", () => {
    expect(DEFAULT_ORDER.hr[0]).toBe("action_center");
    expect(DEFAULT_ORDER.executive[0]).toBe("alert_counts");
    expect(WIDGETS.action_center.kinds).toEqual(["hr"]);
    expect(WIDGETS.alert_counts.kinds).toEqual(["executive"]);
  });

  it("hides a new widget that is hidden by default", () => {
    const saved = { order: ["projects_chart", "workforce"], hidden: [] };
    const layout = resolveLayout("executive", saved);
    expect(layout.hidden).toEqual(["by_trade"]);
  });

  it("drops widgets that no longer exist, repeats, and ones this Home cannot hold", () => {
    const layout = resolveLayout("hr", {
      order: ["expiry", "expiry", "retired", "projects_table", "workforce"],
      hidden: ["retired", "projects_table", "due"],
    });
    expect(layout.order).not.toContain("projects_table" as WidgetId); // MD-only
    expect(layout.order.filter((id) => id === "expiry")).toHaveLength(1);
    expect(layout.hidden).toEqual(["due"]);
    expect(layout.order.every((id) => id in WIDGETS)).toBe(true);
  });

  it("is the same widgets, whatever was saved", () => {
    const layout = resolveLayout("hr", { order: ["leaving"], hidden: ["leaving"] });
    expect([...layout.order].sort()).toEqual([...DEFAULT_ORDER.hr].sort());
  });
});

describe("changing a layout", () => {
  const start = defaultLayout("hr");

  it("moves a widget to where another one is", () => {
    const next = move(start, "leaving", "action_center");
    expect(next.order[0]).toBe("leaving");
    expect(next.order[1]).toBe("action_center");
    expect(next.order).toHaveLength(start.order.length);
    expect(move(start, "expiry", "expiry")).toBe(start);
  });

  it("hides and shows widgets, and a shown widget goes to the end", () => {
    const hidden = hide(start, "workforce");
    expect(visibleWidgets(hidden)).not.toContain("workforce");
    expect(hide(hidden, "workforce")).toBe(hidden);
    const back = show(hidden, "workforce");
    expect(back.hidden).toEqual([]);
    expect(back.order.at(-1)).toBe("workforce");
    expect(show(back, "workforce")).toBe(back);
  });

  it("knows when a layout is the default again, so nothing needs saving", () => {
    expect(isDefaultLayout("hr", start)).toBe(true);
    expect(isDefaultLayout("hr", move(start, "leaving", "expiry"))).toBe(false);
    expect(isDefaultLayout("hr", hide(start, "due"))).toBe(false);
    expect(isDefaultLayout("hr", show(hide(start, "due"), "due"))).toBe(false); // moved to the end
  });

  it("is what the API stores", () => {
    expect(toSaved(hide(start, "due"))).toEqual({ order: start.order, hidden: ["due"] });
  });
});
