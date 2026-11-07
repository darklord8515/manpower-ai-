import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KanbanBoard } from "./KanbanBoard";

type Item = { id: string; name: string };

const columns = [
  {
    id: "a",
    title: "Waiting",
    hint: "Not started",
    items: [{ id: "1", name: "Aamir" }],
    empty: "Nobody is waiting.",
  },
  { id: "b", title: "Done", hint: "Finished", items: [] as Item[], empty: "Nothing is done yet." },
];

function setup() {
  render(
    <KanbanBoard
      label="Pipeline"
      columns={columns}
      keyOf={(i) => i.id}
      renderCard={(i) => <button type="button">{i.name}</button>}
    />,
  );
}

describe("KanbanBoard", () => {
  it("names the board and each column, with how many people are in it", () => {
    setup();
    expect(screen.getByRole("group", { name: "Pipeline" })).toBeInTheDocument();
    const waiting = screen.getByRole("region", { name: "Waiting" });
    expect(within(waiting).getByLabelText("1 person")).toBeInTheDocument();
    expect(within(waiting).getByText("Not started")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Done" })).getByLabelText("0 people"),
    ).toBeInTheDocument();
  });

  it("renders a card for every item and says what an empty column is for", () => {
    setup();
    expect(screen.getByRole("button", { name: "Aamir" })).toBeInTheDocument();
    expect(screen.getByText("Nothing is done yet.")).toBeInTheDocument();
    expect(screen.queryByText("Nobody is waiting.")).not.toBeInTheDocument();
  });
});
