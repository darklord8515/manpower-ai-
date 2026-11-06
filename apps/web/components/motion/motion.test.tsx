import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NumberTicker } from "./NumberTicker";
import { PageTransition } from "./PageTransition";
import { revealProps } from "./Reveal";
import { SlidingTabs } from "./SlidingTabs";
import { StateSwap } from "./StateSwap";

const TABS = [
  { id: "a", label: "Expired", count: 2 },
  { id: "b", label: "Next 30 days", count: 8 },
];

describe("SlidingTabs", () => {
  it("shows labels with counts and marks the chosen one as pressed", () => {
    render(
      <SlidingTabs tabs={TABS} value="b" onChange={() => undefined} label="When it expires" />,
    );
    expect(screen.getByRole("group", { name: "When it expires" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next 30 days · 8" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Expired · 2" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("calls onChange on click and on Enter and Space (plain buttons, no custom keyboard code)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SlidingTabs tabs={TABS} value="b" onChange={onChange} label="When" />);
    await user.click(screen.getByRole("button", { name: "Expired · 2" }));
    expect(onChange).toHaveBeenLastCalledWith("a");
    screen.getByRole("button", { name: "Expired · 2" }).focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("moves the highlight to the newly chosen tab", () => {
    const { rerender } = render(
      <SlidingTabs tabs={TABS} value="a" onChange={() => undefined} label="When" />,
    );
    const pill = () => document.querySelectorAll("[aria-hidden='true'].absolute");
    expect(pill()).toHaveLength(1);
    rerender(<SlidingTabs tabs={TABS} value="b" onChange={() => undefined} label="When" />);
    expect(pill()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Next 30 days · 8" }).contains(pill()[0])).toBe(true);
  });
});

describe("NumberTicker", () => {
  it("counts to the value and gives screen readers the final number once", async () => {
    const { container } = render(<NumberTicker value={112} />);
    expect(container.querySelector("b")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("112", { selector: ".sr-only" })).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector("b")).toHaveTextContent("112"), {
      timeout: 2500,
    });
  });

  it("formats percentages", async () => {
    const { container } = render(<NumberTicker value={94.7} format="percent" />);
    await waitFor(() => expect(container.querySelector("b")).toHaveTextContent("94.7%"), {
      timeout: 2500,
    });
  });
});

describe("revealProps", () => {
  it("staggers the first eight rows 25ms apart", () => {
    const delay = (i: number) =>
      (revealProps(i) as { transition: { delay: number } }).transition.delay;
    expect(delay(0)).toBe(0);
    expect(delay(2)).toBeCloseTo(0.05);
  });

  it("does not animate row 9 onwards, so long lists never make people wait", () => {
    expect(revealProps(8)).toEqual({ initial: false });
    expect(revealProps(40)).toEqual({ initial: false });
  });
});

describe("StateSwap", () => {
  it("shows the new state after the old one fades out", async () => {
    const { rerender } = render(<StateSwap stateKey="loading">Loading…</StateSwap>);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    rerender(<StateSwap stateKey="data">12 workers</StateSwap>);
    await waitFor(() => expect(screen.getByText("12 workers")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
  });
});

describe("PageTransition", () => {
  it("renders its content and replaces it when the key changes", async () => {
    const { rerender } = render(<PageTransition transitionKey="/a">Page A</PageTransition>);
    expect(screen.getByText("Page A")).toBeInTheDocument();
    await act(async () => {
      rerender(<PageTransition transitionKey="/b">Page B</PageTransition>);
    });
    expect(screen.getByText("Page B")).toBeInTheDocument();
    expect(screen.queryByText("Page A")).not.toBeInTheDocument();
  });
});
