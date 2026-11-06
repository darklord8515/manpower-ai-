import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PickList } from "./PickList";
import { pick } from "./test-data";

function setup(props: Partial<React.ComponentProps<typeof PickList>> = {}) {
  const handlers = {
    onToggle: vi.fn(),
    onToggleAll: vi.fn(),
    onRemove: vi.fn(),
    onSwap: vi.fn(),
    onRestore: vi.fn(),
  };
  render(
    <PickList
      picks={[
        pick("EMP-0107", "Imran Qureshi"),
        pick("EMP-0132", "Anil Thapa", {
          group: "finishing",
          from_project: "RAK-05",
          source: "hr",
          level: null,
        }),
        pick("EMP-0142", "Zubair Ali", { removed_reason: "Needed on another project" }),
      ]}
      editable
      selected={new Set()}
      swapping={null}
      restoreProblems={{}}
      busy={false}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, user: userEvent.setup() };
}

describe("PickList", () => {
  it("lists the chosen workers, then the removed ones with their reason", () => {
    setup();
    const chosen = within(screen.getByRole("list", { name: "Chosen workers" }));
    expect(chosen.getAllByRole("listitem")).toHaveLength(2);
    expect(chosen.getByText("Imran Qureshi")).toBeInTheDocument();
    const removed = within(screen.getByRole("region", { name: "Removed workers" }));
    expect(removed.getByText("Needed on another project")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Removed (1)" })).toBeInTheDocument();
  });

  it("says who chose each person, and reads the level and the source in words", () => {
    setup();
    expect(screen.getByText("Suggested by the rules")).toBeInTheDocument();
    expect(screen.getByText("Chosen by HR")).toBeInTheDocument();
    expect(screen.getByText("Level 3")).toBeInTheDocument();
    expect(screen.getByText("No level")).toBeInTheDocument();
  });

  it("swaps, removes and restores through the buttons", async () => {
    const { user, onSwap, onRemove, onRestore } = setup();
    await user.click(screen.getByRole("button", { name: "Swap Imran Qureshi" }));
    expect(onSwap).toHaveBeenCalledWith("EMP-0107");
    await user.click(screen.getByRole("button", { name: "Remove Anil Thapa" }));
    expect(onRemove).toHaveBeenCalledWith(["EMP-0132"]);
    await user.click(screen.getByRole("button", { name: "Restore Zubair Ali" }));
    expect(onRestore).toHaveBeenCalledWith("EMP-0142");
  });

  it("selects one worker or all of them", async () => {
    const { user, onToggle, onToggleAll } = setup();
    await user.click(screen.getByLabelText("Select Imran Qureshi"));
    expect(onToggle).toHaveBeenCalledWith("EMP-0107");
    await user.click(screen.getByLabelText("Select every chosen worker"));
    expect(onToggleAll).toHaveBeenCalledWith(true);
  });

  it("offers Cancel swap on the worker being replaced", async () => {
    const { user, onSwap } = setup({ swapping: "EMP-0107" });
    expect(
      screen.getByText("Choose who takes Imran Qureshi’s place in the pool."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel swap" }));
    expect(onSwap).toHaveBeenCalledWith(null);
    expect(screen.queryByRole("button", { name: "Swap Imran Qureshi" })).not.toBeInTheDocument();
  });

  it("shows what changed since someone was chosen, with the rule code", () => {
    setup({
      picks: [
        pick("EMP-0107", "Imran Qureshi", {
          violations: [{ rule: "DOC_VALID_THROUGH", message: "Residency visa ends 12 Jan 2027" }],
        }),
      ],
    });
    expect(screen.getByText(/Residency visa ends 12 Jan 2027/)).toBeInTheDocument();
    expect(screen.getByText("DOC_VALID_THROUGH")).toBeInTheDocument();
  });

  it("shows why a restore was refused", () => {
    setup({
      restoreProblems: { "EMP-0142": [{ rule: "ASSIGN_OVERLAP", message: "Already on RAK-02" }] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Already on RAK-02");
  });

  it("is read-only without permission: no checkboxes, no buttons", () => {
    setup({ editable: false });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Imran Qureshi")).toBeInTheDocument();
  });

  it("disables the row buttons while something is saving", () => {
    setup({ busy: true });
    expect(screen.getByRole("button", { name: "Swap Imran Qureshi" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restore Zubair Ali" })).toBeDisabled();
  });
});
