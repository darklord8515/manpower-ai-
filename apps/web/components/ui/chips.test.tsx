import { render, screen } from "@testing-library/react";
import { CheckCircle2, Inbox } from "lucide-react";
import { describe, expect, it } from "vitest";
import { SeverityChip } from "./SeverityChip";
import { StatusChip } from "./StatusChip";

describe("StatusChip", () => {
  it("always carries an icon and a text label, never colour alone", () => {
    const { container } = render(
      <StatusChip tone="success" icon={CheckCircle2} label="Resolved" />,
    );
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    const icon = container.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("exposes its tone and swaps the label when the state changes", async () => {
    const { container, rerender } = render(<StatusChip tone="neutral" icon={Inbox} label="Open" />);
    expect(container.querySelector("[data-tone]")).toHaveAttribute("data-tone", "neutral");
    rerender(<StatusChip tone="success" icon={CheckCircle2} label="Resolved" />);
    expect(await screen.findByText("Resolved")).toBeInTheDocument();
    expect(container.querySelector("[data-tone]")).toHaveAttribute("data-tone", "success");
  });
});

describe("SeverityChip", () => {
  it.each([
    ["critical", "Critical", "danger"],
    ["action_needed", "Action needed", "warning"],
    ["info", "Info", "info"],
  ] as const)("%s shows the label '%s' with the %s tone", (severity, label, tone) => {
    const { container } = render(<SeverityChip severity={severity} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelector("[data-tone]")).toHaveAttribute("data-tone", tone);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
