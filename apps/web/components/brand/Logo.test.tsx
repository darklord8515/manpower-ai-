import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AlhamraMark, AlhamraWordmark } from "./Logo";
import { MARK, WORDMARK } from "./logo-markup";

describe("brand logos", () => {
  it("renders the wordmark as a labelled image that takes its colour from the text", () => {
    render(<AlhamraWordmark />);
    const logo = screen.getByRole("img", { name: "Alhamra Construction & Development" });
    expect(logo).toHaveClass("fill-current");
    expect(logo).toHaveAttribute("viewBox", WORDMARK.viewBox);
    expect(logo.querySelectorAll("path, polygon, rect").length).toBeGreaterThan(20);
  });

  it("renders the mark with its own viewBox", () => {
    render(<AlhamraMark />);
    expect(screen.getByRole("img", { name: "Alhamra" })).toHaveAttribute("viewBox", MARK.viewBox);
  });

  it("hides a decorative logo from assistive technology", () => {
    const { container } = render(<AlhamraMark label="" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("carries no hard-coded colours, so it works on light and dark", () => {
    expect(WORDMARK.inner).not.toMatch(/fill=/);
    expect(MARK.inner).not.toMatch(/fill=/);
  });
});
