import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { HR, summary } from "./test-data";

const alertSummary = vi.fn();
let signedIn: typeof HR = HR;

vi.mock("@/components/auth/AuthProvider", () => ({ useUser: () => signedIn }));
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, api: { ...original.api, alertSummary: () => alertSummary() } };
});

import { BellMenu } from "./BellMenu";

// A block body: an arrow that returns the mock would be run by Vitest as a cleanup function.
beforeEach(() => {
  alertSummary.mockReset();
  signedIn = HR;
});

describe("BellMenu", () => {
  it("shows nothing to someone who cannot read alerts, and asks for nothing", () => {
    signedIn = { ...HR, permissions: ["project:read"] };
    render(<BellMenu />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(alertSummary).not.toHaveBeenCalled();
  });

  it("says how many alerts need attention, in the badge and in words", async () => {
    alertSummary.mockResolvedValue(summary());
    render(<BellMenu />);
    const bell = await screen.findByRole("button", { name: "Alerts: 18 need attention" });
    expect(bell).toHaveTextContent("18");
  });

  it("lists the most urgent alerts with how long ago, and links to the To-do list", async () => {
    alertSummary.mockResolvedValue(summary());
    const user = userEvent.setup();
    render(<BellMenu />);
    await user.click(await screen.findByRole("button", { name: /Alerts: 18/ }));
    expect(
      await screen.findByRole("menuitem", { name: /Harish Mondal: residency visa ends in 3 days/ }),
    ).toHaveAttribute("href", "/todo?alert=a1");
    expect(screen.getAllByText("just now").length).toBeGreaterThan(0);
    expect(screen.getByRole("menuitem", { name: "Open To-do" })).toHaveAttribute("href", "/todo");
    expect(screen.getByText("Detectors last ran at 09:00 on 5 Nov 2026.")).toBeInTheDocument();
  });

  it("says so when nothing needs attention", async () => {
    alertSummary.mockResolvedValue(
      summary({ counts: { critical: 0, action_needed: 0, info: 3 }, needs_attention: 0, top: [] }),
    );
    const user = userEvent.setup();
    render(<BellMenu />);
    const bell = await screen.findByRole("button", { name: "Alerts: 0 need attention" });
    expect(bell).not.toHaveTextContent(/\d/); // no badge
    await user.click(bell);
    expect(await screen.findByText("Nothing needs attention.")).toBeInTheDocument();
  });

  it("explains a failure inside the menu and lets the person try again", async () => {
    alertSummary.mockRejectedValueOnce(new ApiError(500, "The alerts are unavailable."));
    alertSummary.mockResolvedValueOnce(summary());
    const user = userEvent.setup();
    render(<BellMenu />);
    await user.click(await screen.findByRole("button", { name: "Alerts" }));
    expect(await screen.findByText(/The alerts are unavailable\./)).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /Retry/ }));
    // The menu stays open, and now lists the alerts.
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: /Harish Mondal: residency visa ends in 3 days/ }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/The alerts are unavailable/)).not.toBeInTheDocument();
  });
});
