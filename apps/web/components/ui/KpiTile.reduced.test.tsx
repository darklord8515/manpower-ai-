import { render, screen } from "@testing-library/react";
import { Users } from "lucide-react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { KpiTile } from "./KpiTile";

describe("KpiTile (prefers-reduced-motion)", () => {
  beforeAll(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    );
  });

  it("shows the final value at once, with no counting", () => {
    const { container } = render(<KpiTile label="Deployed" icon={Users} value={3412} />);
    expect(container.querySelector("b")).toHaveTextContent("3,412");
  });

  it("formats percentages with one decimal and shows the supporting text", () => {
    render(
      <KpiTile
        label="Doc compliance"
        icon={Users}
        value={94.7}
        format="percent"
        of="of 600"
        trend="+1.2 this week"
        detail="8 expire within 30 days"
      />,
    );
    expect(screen.getByText("94.7%", { selector: ".sr-only" })).toBeInTheDocument();
    expect(screen.getByText("of 600")).toBeInTheDocument();
    expect(screen.getByText("+1.2 this week")).toBeInTheDocument();
    expect(screen.getByText("8 expire within 30 days")).toBeInTheDocument();
  });
});
