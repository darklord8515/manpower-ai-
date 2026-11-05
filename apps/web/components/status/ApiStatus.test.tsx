import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiStatus } from "./ApiStatus";

function answer(body: unknown, init: { ok: boolean; status: number }) {
  return Promise.resolve({ ...init, json: () => Promise.resolve(body) } as Response);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ApiStatus", () => {
  it("shows a loading skeleton, then the healthy state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => answer({ status: "ok", db: "ok", env: "local" }, { ok: true, status: 200 })),
    );
    render(<ApiStatus baseUrl="http://api.test" />);
    expect(screen.getByLabelText("Checking the API")).toHaveAttribute("aria-busy", "true");
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("local")).toBeInTheDocument();
    expect(screen.queryByLabelText("Checking the API")).toBeNull();
  });

  it("asks the configured API for /health", async () => {
    const fetchMock = vi.fn(() =>
      answer({ status: "ok", db: "ok", env: "demo" }, { ok: true, status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ApiStatus baseUrl="http://api.test" />);
    await screen.findByText("Connected");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/health",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("shows a degraded database as a warning, not a crash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        answer({ status: "degraded", db: "down", env: "local" }, { ok: false, status: 503 }),
      ),
    );
    render(<ApiStatus baseUrl="http://api.test" />);
    expect(await screen.findByText("Unreachable")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("shows an error with a working Retry when the API cannot be reached", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockImplementation(() =>
        answer({ status: "ok", db: "ok", env: "local" }, { ok: true, status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<ApiStatus baseUrl="http://api.test" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("API unreachable");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("explains the free-hosting wake-up delay when the API is slow", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    render(<ApiStatus baseUrl="http://api.test" />);
    expect(screen.queryByText(/sleeps after 15 minutes/)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    expect(screen.getByText(/sleeps after 15 minutes/)).toBeInTheDocument();
  });
});
