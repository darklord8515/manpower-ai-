import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DataTable, type Column } from "./DataTable";

type Row = { code: string; name: string; level: number };
const ROWS: Row[] = [
  { code: "A", name: "Mohammed", level: 3 },
  { code: "B", name: "Anil", level: 4 },
  { code: "C", name: "Suresh", level: 2 },
];
const COLUMNS: Column<Row>[] = [
  { key: "name", header: "Worker", sortValue: (r) => r.name, cell: (r) => r.name },
  {
    key: "level",
    header: "Level",
    align: "right",
    sortValue: (r) => r.level,
    cell: (r) => r.level,
  },
  { key: "note", header: "Note", cell: () => "—" },
];

function names() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0].textContent);
}

function renderTable(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return render(
    <DataTable
      caption="Workers"
      columns={COLUMNS}
      rows={ROWS}
      rowKey={(r) => r.code}
      empty={<p>Nothing here</p>}
      {...props}
    />,
  );
}

describe("DataTable", () => {
  it("sorts ascending, descending, then back to the original order", async () => {
    renderTable();
    const header = screen.getByRole("columnheader", { name: /Worker/ });
    expect(header).toHaveAttribute("aria-sort", "none");
    expect(names()).toEqual(["Mohammed", "Anil", "Suresh"]);

    await userEvent.click(screen.getByRole("button", { name: /Worker/ }));
    expect(header).toHaveAttribute("aria-sort", "ascending");
    expect(names()).toEqual(["Anil", "Mohammed", "Suresh"]);

    await userEvent.click(screen.getByRole("button", { name: /Worker/ }));
    expect(header).toHaveAttribute("aria-sort", "descending");
    expect(names()).toEqual(["Suresh", "Mohammed", "Anil"]);

    await userEvent.click(screen.getByRole("button", { name: /Worker/ }));
    expect(names()).toEqual(["Mohammed", "Anil", "Suresh"]);
  });

  it("sorts numbers numerically and leaves unsortable columns without a sort button", async () => {
    renderTable();
    await userEvent.click(screen.getByRole("button", { name: /Level/ }));
    expect(names()).toEqual(["Suresh", "Mohammed", "Anil"]);
    expect(screen.queryByRole("button", { name: /Note/ })).toBeNull();
  });

  it("selects single rows and all rows", async () => {
    function Controlled() {
      const [selected, setSelected] = useState<Set<string>>(new Set());
      return (
        <>
          <output aria-label="count">{selected.size}</output>
          <DataTable
            caption="Workers"
            columns={COLUMNS}
            rows={ROWS}
            rowKey={(r) => r.code}
            empty={null}
            selectable
            selected={selected}
            onSelectedChange={setSelected}
          />
        </>
      );
    }
    render(<Controlled />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Select row B" }));
    expect(screen.getByLabelText("count")).toHaveTextContent("1");
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all rows" }));
    expect(screen.getByLabelText("count")).toHaveTextContent("3");
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all rows" }));
    expect(screen.getByLabelText("count")).toHaveTextContent("0");
  });

  it("shows a loading skeleton instead of rows", () => {
    renderTable({ loading: true });
    expect(screen.getByRole("status", { name: "Loading Workers" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the empty state when there are no rows", () => {
    renderTable({ rows: [] });
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("shows the error with a Retry that calls back", async () => {
    const onRetry = vi.fn();
    renderTable({ error: { message: "The API did not answer.", onRetry } });
    expect(screen.getByRole("alert")).toHaveTextContent("The API did not answer.");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders mobile cards for the same rows when asked to", () => {
    renderTable({ mobileCard: (r) => <span>card:{r.name}</span> });
    expect(screen.getByText("card:Anil")).toBeInTheDocument();
  });
});
