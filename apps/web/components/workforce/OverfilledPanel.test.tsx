import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WOverfilled } from "@/lib/api-types";

const api = { wProjects: vi.fn(), wMove: vi.fn(), wMilestone: vi.fn() };
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: {
      ...original.api,
      wProjects: (...a: unknown[]) => api.wProjects(...a),
      wMove: (...a: unknown[]) => api.wMove(...a),
      wMilestone: (...a: unknown[]) => api.wMilestone(...a),
    },
  };
});

import { OverfilledPanel } from "./OverfilledPanel";

const ASK: WOverfilled = {
  table: [{ project: "Greens", designation: "Steel fixer", planned: 10, now: 10, after: 11 }],
  people: [{ code: "200016", name: "Alice Test", status: "active" }],
  project: "GREEN",
  options: ["increase_plan", "choose_another_person", "cancel"],
};

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.wProjects.mockResolvedValue([
    { code: "GREEN", name: "Greens" },
    { code: "WF", name: "Marina Waterfront" },
  ]);
});

function setup() {
  const onRaise = vi.fn();
  const onCancel = vi.fn();
  const onFreed = vi.fn();
  render(
    <OverfilledPanel
      detail="Greens plans 10 Steel fixer and already has 10."
      ask={ASK}
      busy={false}
      onRaise={onRaise}
      onCancel={onCancel}
      onFreed={onFreed}
    />,
  );
  return { onRaise, onCancel, onFreed, user: userEvent.setup() };
}

describe("OverfilledPanel", () => {
  it("says nothing is saved yet and shows the planned, now and after numbers", () => {
    setup();
    expect(screen.getByRole("alert")).toHaveTextContent("Nothing has been saved yet");
    const row = screen.getByRole("row", { name: /Steel fixer/ });
    expect(row).toHaveTextContent("10");
    expect(row).toHaveTextContent("11");
  });

  it("lets HR raise the plan or cancel", async () => {
    const { onRaise, onCancel, user } = setup();
    await user.click(screen.getByRole("button", { name: "Raise the plan by 1 and continue" }));
    expect(onRaise).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("moves someone else to another project, and then asks to try again", async () => {
    api.wMove.mockResolvedValue({ message: "moved" });
    const { onFreed, user } = setup();
    const move = screen.getByRole("button", { name: "Move" });
    expect(move).toBeDisabled(); // no project chosen yet
    await user.selectOptions(await screen.findByLabelText("Move Alice Test to"), "WF");
    await user.click(move);
    expect(api.wMove).toHaveBeenCalledWith("200016", "WF");
    expect(onFreed).toHaveBeenCalledWith("Alice Test was moved. Try again.");
  });

  it("can resign someone to free the place", async () => {
    api.wMilestone.mockResolvedValue({ code: "200016", status: "resigned" });
    const { onFreed, user } = setup();
    await user.click(screen.getByRole("button", { name: "Resign" }));
    expect(api.wMilestone).toHaveBeenCalledWith("200016", "resigned");
    expect(onFreed).toHaveBeenCalledWith("Alice Test was marked as resigned. Try again.");
  });
});
