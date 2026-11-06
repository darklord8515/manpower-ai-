import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src }: { src: string }) => <img alt="" src={src} data-testid="hero-image" />,
}));

import { Hero } from "./Hero";

// Dubai is UTC+4: 08:00 UTC is midday there.
function timeIs(iso: string) {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date(iso));
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.useRealTimers());

describe("Hero greeting", () => {
  it.each([
    ["2026-11-05T03:30:00Z", "Good morning, Noura", "morning"], // 07:30 Dubai
    ["2026-11-05T09:00:00Z", "Good afternoon, Noura", "afternoon"], // 13:00
    ["2026-11-05T14:00:00Z", "Good evening, Noura", "evening"], // 18:00
    ["2026-11-04T23:30:00Z", "Good evening, Noura", "evening"], // 03:30 on the 5th
  ])("at %s says %s with the %s picture", (time, text, period) => {
    timeIs(time);
    render(<Hero fullName="Noura Demo" roleLabel="HR Manager" insight="8 documents run out." />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(text);
    expect(screen.getByTestId("hero-image")).toHaveAttribute("src", `/hero/${period}.webp`);
    expect(screen.getByText("HR Manager")).toBeInTheDocument();
    expect(screen.getByText("8 documents run out.")).toBeInTheDocument();
  });

  it("changes picture and greeting when the clock passes 17:00, without a reload", async () => {
    timeIs("2026-11-05T12:59:40Z"); // 16:59:40 in Dubai
    render(<Hero fullName="Layla Demo" roleLabel="MD / CEO" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Good afternoon, Layla");
    await act(async () => {
      vi.setSystemTime(new Date("2026-11-05T13:00:30Z"));
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Good evening, Layla");
  });

  it("shows the preview chosen in the demo tools instead of the real time", () => {
    timeIs("2026-11-05T03:30:00Z");
    sessionStorage.setItem("cq.previewPeriod", "evening");
    render(<Hero fullName="Priya Demo" roleLabel="HR Executive" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Good evening, Priya");
  });
});
