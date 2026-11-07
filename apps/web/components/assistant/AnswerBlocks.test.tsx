import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatBlock } from "@/lib/api-types";
import { AnswerBlocks } from "./AnswerBlocks";

describe("AnswerBlocks", () => {
  it("draws counts with their tone", () => {
    const blocks: ChatBlock[] = [
      {
        type: "kpis",
        items: [
          { label: "Critical", value: "2", tone: "bad" },
          { label: "Info", value: "29", tone: "neutral" },
        ],
      },
    ];
    render(<AnswerBlocks blocks={blocks} />);
    expect(screen.getByText("Critical").nextSibling).toHaveTextContent("2");
    expect(screen.getByText("Critical").nextSibling).toHaveClass("text-danger-text");
    expect(screen.getByText("Info").nextSibling).toHaveClass("text-fg");
  });

  it("draws a table: headers, cells, a dash for nothing, and a scroll box instead of a wide page", () => {
    const blocks: ChatBlock[] = [
      {
        type: "table",
        title: "Documents",
        columns: [
          { key: "code", label: "Code", align: "left" },
          { key: "days", label: "Days", align: "right" },
        ],
        rows: [
          { code: "EMP-0142", days: 12 },
          { code: "EMP-0107", days: null },
        ],
        total: 2,
        href: null,
      },
    ];
    const { container } = render(<AnswerBlocks blocks={blocks} />);
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Days" })).toHaveClass("text-right");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText("12")).toHaveClass("tabular-nums");
    expect(within(rows[2]).getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Documents")).toBeInTheDocument();
    expect(container.querySelector(".overflow-x-auto")).toContainElement(table);
  });

  it("lists alerts as links that open the alert on the To-do screen", () => {
    const blocks: ChatBlock[] = [
      {
        type: "alerts",
        total: 1,
        items: [
          {
            id: "a1",
            severity: "critical",
            title: "A visa ended 3 days ago",
            project: "RAK-02",
            raised: "4 Nov 2026",
          },
        ],
      },
    ];
    render(<AnswerBlocks blocks={blocks} />);
    const link = screen.getByRole("link", { name: /A visa ended 3 days ago/ });
    expect(link).toHaveAttribute("href", "/todo?alert=a1");
    expect(link).toHaveTextContent("RAK-02 · raised 4 Nov 2026");
    expect(link).toHaveTextContent("Critical");
  });

  it("draws bars with a spoken value, and caps a bar at its maximum", () => {
    const blocks: ChatBlock[] = [
      {
        type: "bars",
        title: "Deployed against planned",
        items: [
          { label: "RAK-02", value: 8, of: 8, detail: "Saqr Business Park" },
          { label: "RAK-03", value: 12, of: 10, detail: null },
          { label: "RAK-04", value: 3, of: null, detail: null },
        ],
      },
    ];
    render(<AnswerBlocks blocks={blocks} />);
    expect(screen.getByRole("img", { name: "RAK-02: 8 of 8" })).toBeInTheDocument();
    const over = screen.getByRole("img", { name: "RAK-03: 12 of 10" });
    expect((over.firstChild as HTMLElement).style.width).toBe("100%");
    expect(screen.getByRole("img", { name: "RAK-04: 3" })).toBeInTheDocument();
    expect(screen.getByText("8 / 8")).toBeInTheDocument();
  });

  it("draws notes as notes", () => {
    render(
      <AnswerBlocks
        blocks={[
          { type: "note", tone: "warning", text: "Residency visa expired 3 days ago." },
          { type: "note", tone: "info", text: "Try fewer filters." },
        ]}
      />,
    );
    const notes = screen.getAllByRole("note");
    expect(notes[0]).toHaveClass("bg-warning-soft");
    expect(notes[1]).toHaveClass("bg-info-soft");
  });
});
