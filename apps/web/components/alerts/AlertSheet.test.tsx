import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { HR, NOW, alertDetail } from "./test-data";

const api = {
  alert: vi.fn(),
  takeAlert: vi.fn(),
  assignAlert: vi.fn(),
  snoozeAlert: vi.fn(),
  dismissAlert: vi.fn(),
  alertAssignees: vi.fn(),
};

vi.mock("@/components/auth/AuthProvider", () => ({ useUser: () => HR }));
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: {
      ...original.api,
      alert: (...a: unknown[]) => api.alert(...a),
      takeAlert: (...a: unknown[]) => api.takeAlert(...a),
      assignAlert: (...a: unknown[]) => api.assignAlert(...a),
      snoozeAlert: (...a: unknown[]) => api.snoozeAlert(...a),
      dismissAlert: (...a: unknown[]) => api.dismissAlert(...a),
      alertAssignees: () => api.alertAssignees(),
    },
  };
});

import { AlertSheet, hrefFor } from "./AlertSheet";

function setup() {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  render(
    <AlertSheet
      alertId="alert-1"
      fallbackTitle="Sanjeev"
      now={NOW}
      onClose={onClose}
      onChanged={onChanged}
    />,
  );
  return { onClose, onChanged, user: userEvent.setup() };
}

// A block body: an arrow that returns the mock would be run by Vitest as a cleanup function.
beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.alertAssignees.mockResolvedValue([
    { id: "u-noura", name: "Noura Demo", role: "HR Manager" },
    { id: "u-priya", name: "Priya Demo", role: "HR Executive" },
  ]);
});

describe("hrefFor", () => {
  it("points each action at a screen that exists", () => {
    const link = (action: string, params: Record<string, string>) =>
      hrefFor({ action, label: "x", params });
    expect(link("open_forecast", { project: "RAK-07" })).toBe("/projects/RAK-07/forecast");
    expect(link("open_allocation", { request: "SR-2026-0001" })).toBe(
      "/requests?request=SR-2026-0001",
    );
    expect(link("open_allocation", {})).toBe("/requests");
    expect(link("open_mobilization", { mob_no: "MOB-2026-0107" })).toBe(
      "/mobilization?mob=MOB-2026-0107",
    );
    expect(link("open_worker", { worker: "EMP-0088" })).toBe("/workers?worker=EMP-0088");
    expect(link("send_reminder", {})).toBeNull(); // not built: no button
  });
});

describe("AlertSheet", () => {
  it("shows the explanation, the facts behind it, the action and the history", async () => {
    api.alert.mockResolvedValue(alertDetail());
    setup();
    expect(await screen.findByText(/ends in 7 days, on 12 Nov 2026/)).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Facts behind this alert" });
    expect(within(table).getByText("Sanjeev Rana")).toBeInTheDocument();
    expect(within(table).getByText("12 Nov 2026")).toBeInTheDocument();
    expect(within(table).getByText("EMP-0088")).toHaveClass("font-mono");
    expect(screen.getByRole("link", { name: "Open worker" })).toHaveAttribute(
      "href",
      "/workers?worker=EMP-0088",
    );
    expect(screen.getByRole("region", { name: "History" })).toHaveTextContent("Raised");
    expect(screen.queryByText("Written by AI from the facts below")).not.toBeInTheDocument();
  });

  it("says when the words were written by the narrator", async () => {
    api.alert.mockResolvedValue(alertDetail({ narrated: true }));
    setup();
    expect(await screen.findByText("Written by AI from the facts below")).toBeInTheDocument();
  });

  it("is read-only for someone who cannot act, but still offers the links", async () => {
    api.alert.mockResolvedValue(alertDetail({ can_act: false, can_dismiss: false }));
    setup();
    expect(await screen.findByText("Only HR works on alerts.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Take it|Assign|Snooze|Dismiss/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open worker" })).toBeInTheDocument();
  });

  it("says when it moved up because nobody took it", async () => {
    api.alert.mockResolvedValue(alertDetail({ escalation_level: 1, escalated_to: "HR Manager" }));
    setup();
    expect(
      await screen.findByText("Nobody took this in time, so it moved up to the HR Manager."),
    ).toBeInTheDocument();
  });

  it("takes the alert and tells the list", async () => {
    api.alert.mockResolvedValue(alertDetail());
    api.takeAlert.mockResolvedValue(
      alertDetail({ status: "in_progress", assignee: "Noura Demo", assignee_id: HR.id }),
    );
    const { user, onChanged } = setup();
    await user.click(await screen.findByRole("button", { name: "Take it" }));
    expect(await screen.findByText("You took this alert.")).toBeInTheDocument();
    expect(api.takeAlert).toHaveBeenCalledWith("alert-1");
    expect(await screen.findByText("You are working on this.")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it("assigns it to someone who works on alerts", async () => {
    api.alert.mockResolvedValue(alertDetail());
    api.assignAlert.mockResolvedValue(
      alertDetail({ status: "in_progress", assignee: "Priya Demo", assignee_id: "u-priya" }),
    );
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Assign" }));
    const form = screen.getByRole("form", { name: "Assign this alert" });
    expect(within(form).getByRole("button", { name: "Assign" })).toBeDisabled();
    await user.selectOptions(within(form).getByLabelText("Assign to"), "u-priya");
    await user.click(within(form).getByRole("button", { name: "Assign" }));
    expect(await screen.findByText("Assigned to Priya Demo.")).toBeInTheDocument();
    expect(api.assignAlert).toHaveBeenCalledWith("alert-1", "u-priya");
  });

  it("offers only snoozes that fit under the cap for a critical alert", async () => {
    api.alert.mockResolvedValue(alertDetail({ severity: "critical" }));
    api.snoozeAlert.mockResolvedValue(alertDetail({ status: "snoozed" }));
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Snooze" }));
    const panel = screen.getByRole("group", { name: "Snooze until" });
    expect(
      within(panel)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["4 hours", "Tomorrow 07:00", "Cancel"]); // no 3 days and no date box for a critical alert
    await user.click(within(panel).getByRole("button", { name: "4 hours" }));
    expect(api.snoozeAlert).toHaveBeenCalledWith("alert-1", "2026-11-05T09:00:00.000Z");
    expect(await screen.findByText("Snoozed until 5 Nov 2026.")).toBeInTheDocument();
  });

  it("lets a lesser alert be snoozed to a picked day, up to a week", async () => {
    api.alert.mockResolvedValue(alertDetail({ severity: "action_needed" }));
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Snooze" }));
    const panel = screen.getByRole("group", { name: "Snooze until" });
    expect(within(panel).getByRole("button", { name: "3 days" })).toBeInTheDocument();
    const day = within(panel).getByLabelText("Or pick a day");
    expect(day).toHaveAttribute("min", "2026-11-05");
    expect(day).toHaveAttribute("max", "2026-11-12");
  });

  it("will not dismiss without a reason of 10 characters, then dismisses with it", async () => {
    api.alert.mockResolvedValue(alertDetail());
    api.dismissAlert.mockResolvedValue(
      alertDetail({
        status: "dismissed",
        can_act: false,
        resolved_at: NOW,
        resolution_note: "Renewal already started",
      }),
    );
    const { user, onChanged } = setup();
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));
    const form = screen.getByRole("form", { name: "Dismiss this alert" });
    const submit = within(form).getByRole("button", { name: "Dismiss alert" });
    await user.type(within(form).getByLabelText("Why is this being dismissed?"), "too short");
    expect(within(form).getByText(/9 of 10 characters/)).toBeInTheDocument();
    expect(submit).toBeDisabled();
    await user.type(within(form).getByLabelText("Why is this being dismissed?"), "!");
    await user.click(submit);
    expect(api.dismissAlert).toHaveBeenCalledWith("alert-1", "too short!");
    expect(await screen.findByText("Dismissed.")).toBeInTheDocument();
    expect(
      screen.getByText(/Dismissed on 5 Nov 2026: Renewal already started/),
    ).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it("does not offer Dismiss for an alert that can only be snoozed", async () => {
    api.alert.mockResolvedValue(alertDetail({ can_dismiss: false }));
    setup();
    await screen.findByRole("button", { name: "Snooze" });
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });

  it("shows the reason when the API refuses", async () => {
    api.alert.mockResolvedValue(alertDetail());
    api.takeAlert.mockRejectedValue(new ApiError(409, "Priya Demo is already working on this."));
    const { user, onChanged } = setup();
    await user.click(await screen.findByRole("button", { name: "Take it" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Priya Demo is already working on this.",
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("shows a loading state, then an error with a Retry", async () => {
    api.alert.mockRejectedValueOnce(new ApiError(500, "The alert could not be opened."));
    api.alert.mockResolvedValueOnce(alertDetail());
    const { user } = setup();
    expect(screen.getByRole("status", { name: "Loading the alert" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("The alert could not be opened.");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("table", { name: "Facts behind this alert" }),
    ).toBeInTheDocument();
  });
});
