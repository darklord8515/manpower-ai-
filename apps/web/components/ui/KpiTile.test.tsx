import { render, screen, waitFor } from "@testing-library/react";
import { Users } from "lucide-react";
import { describe, expect, it } from "vitest";
import { KpiTile } from "./KpiTile";

// Motion reads the reduced-motion preference once per module load, so the "reduced" cases live in
// KpiTile.reduced.test.tsx. Here the default (no preference) applies.
describe("KpiTile (animated)", () => {
  it("counts up from zero to the value", async () => {
    const { container } = render(<KpiTile label="Deployed" icon={Users} value={112} />);
    const visible = container.querySelector("b");
    expect(visible).toHaveTextContent("0");
    await waitFor(() => expect(visible).toHaveTextContent("112"), { timeout: 2500 });
  });

  it("counts from the old value to the new one when the value changes", async () => {
    const { container, rerender } = render(<KpiTile label="Pending" icon={Users} value={4} />);
    const visible = container.querySelector("b");
    await waitFor(() => expect(visible).toHaveTextContent("4"), { timeout: 2500 });
    rerender(<KpiTile label="Pending" icon={Users} value={3} />);
    await waitFor(() => expect(visible).toHaveTextContent("3"), { timeout: 2500 });
  });

  it("reads the final number once to assistive technology, not every animation frame", () => {
    const { container } = render(<KpiTile label="Deployed" icon={Users} value={112} />);
    expect(container.querySelector("b")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("112", { selector: ".sr-only" })).toBeInTheDocument();
  });
});
