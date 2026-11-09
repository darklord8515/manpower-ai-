import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import type { MobilizationDetail, MobilizationTask } from "@/lib/api-types";

const api = {
  mobilization: vi.fn(),
  markTaskDone: vi.fn(),
  reopenTask: vi.fn(),
  confirmArrival: vi.fn(),
};

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: {
      ...original.api,
      mobilization: (...a: unknown[]) => api.mobilization(...a),
      markTaskDone: (...a: unknown[]) => api.markTaskDone(...a),
      reopenTask: (...a: unknown[]) => api.reopenTask(...a),
      confirmArrival: (...a: unknown[]) => api.confirmArrival(...a),
    },
  };
});

import { MobilizationSheet } from "./MobilizationSheet";

const TITLES: [string, string, string][] = [
  ["hr", "Human Resources", "Verify residency visa and medical fitness"],
  ["operations", "Operations", "Assign a camp bed"],
  ["operations", "Operations", "Arrange transport to site"],
  ["site", "Site workforce", "Issue PPE"],
  ["site", "Site workforce", "Site induction"],
];

function detail(done: number, changes: Partial<MobilizationDetail> = {}): MobilizationDetail {
  const tasks: MobilizationTask[] = TITLES.map(([department, name, title], i) => ({
    id: `task-${i}`,
    department,
    department_name: name,
    title,
    due_on: "2026-11-08",
    status: i < done ? "done" : "open",
    overdue: i === 0 && done === 0,
    done_by: i < done ? "Noura Demo" : null,
    done_at: i < done ? "2026-11-04T09:00:00Z" : null,
  }));
  return {
    mob_no: "MOB-2026-0107",
    stage: done === 5 ? "ready" : done > 0 ? "in_progress" : "pending_checklist",
    status: done > 0 ? "in_progress" : "approved",
    worker_code: "EMP-0507",
    worker_name: "Girish Nair",
    trade: "Mason",
    project_code: "RAK-01",
    project_name: "Marina Waterfront",
    report_on: "2026-11-08",
    tasks_done: done,
    tasks_total: 5,
    overdue: done === 0 ? 1 : 0,
    arrived_on: null,
    tasks,
    can_update: true,
    update_note: null,
    can_confirm_arrival: false,
    arrival_note: "Reports on 8 Nov 2026. Arrival can be confirmed from that day.",
    ...changes,
  };
}

function setup() {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  render(
    <MobilizationSheet
      mobNo="MOB-2026-0107"
      fallbackName="Girish"
      onClose={onClose}
      onChanged={onChanged}
    />,
  );
  return { onClose, onChanged, user: userEvent.setup() };
}

// A block body: an arrow that returns the mock would be run by Vitest as a cleanup function.
beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
});

describe("MobilizationSheet", () => {
  it("shows a loading state, then the checklist grouped by department", async () => {
    api.mobilization.mockResolvedValue(detail(2));
    setup();
    expect(screen.getByRole("status", { name: "Loading the checklist" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Human Resources" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Operations" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Site workforce" })).toBeInTheDocument();
    expect(screen.getByText("2 of 5 tasks done")).toBeInTheDocument();
    expect(screen.getAllByText("Done by Noura Demo, 4 Nov 2026")).toHaveLength(2);
    expect(api.mobilization).toHaveBeenCalledWith("MOB-2026-0107");
  });

  it("marks a task done with the server's answer, and tells the board only when someone arrives", async () => {
    api.mobilization.mockResolvedValue(detail(0));
    api.markTaskDone.mockResolvedValue(detail(1));
    const { user, onChanged } = setup();
    await user.click(
      await screen.findByRole("button", {
        name: "Mark done: Verify residency visa and medical fitness",
      }),
    );
    expect(await screen.findByText("1 of 5 tasks done")).toBeInTheDocument();
    expect(api.markTaskDone).toHaveBeenCalledWith("MOB-2026-0107", "task-0");
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent(
      "Verify residency visa and medical fitness is done.",
    );
    expect(onChanged).toHaveBeenCalledWith(undefined); // the board reloads, with no banner
  });

  it("opens a done task again", async () => {
    api.mobilization.mockResolvedValue(detail(1));
    api.reopenTask.mockResolvedValue(detail(0));
    const { user } = setup();
    await user.click(
      await screen.findByRole("button", {
        name: "Reopen Verify residency visa and medical fitness",
      }),
    );
    expect(await screen.findByText("0 of 5 tasks done, 1 overdue")).toBeInTheDocument();
    expect(api.reopenTask).toHaveBeenCalledWith("MOB-2026-0107", "task-0");
  });

  it("shows the server's reason when a change is refused, and keeps the checklist as it was", async () => {
    api.mobilization.mockResolvedValue(detail(0));
    api.markTaskDone.mockRejectedValue(
      new ApiError(409, "This person has arrived, so the checklist is closed."),
    );
    const { user, onChanged } = setup();
    await user.click(await screen.findByRole("button", { name: /Mark done: Issue PPE/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("checklist is closed");
    expect(screen.getByText("0 of 5 tasks done, 1 overdue")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("is read-only without permission: the reason instead of buttons", async () => {
    api.mobilization.mockResolvedValue(
      detail(2, {
        can_update: false,
        update_note: "Only HR ticks tasks off.",
        arrival_note: "Only HR confirms arrival.",
      }),
    );
    setup();
    expect(await screen.findByText("Only HR ticks tasks off.")).toBeInTheDocument();
    expect(screen.getByText("Only HR confirms arrival.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Mark done|Reopen|Confirm arrival/ }),
    ).not.toBeInTheDocument();
  });

  it("explains why arrival cannot be confirmed yet", async () => {
    api.mobilization.mockResolvedValue(detail(5));
    setup();
    expect(
      await screen.findByText("Reports on 8 Nov 2026. Arrival can be confirmed from that day."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm arrival" })).toBeDisabled();
  });

  it("confirms arrival, closes the checklist and tells the board who is now deployed", async () => {
    api.mobilization.mockResolvedValue(
      detail(5, { can_confirm_arrival: true, arrival_note: null }),
    );
    api.confirmArrival.mockResolvedValue(
      detail(5, {
        stage: "on_site",
        status: "completed",
        arrived_on: "2026-11-08",
        can_update: false,
        can_confirm_arrival: false,
        update_note: "This person has arrived, so the checklist is closed.",
        arrival_note: "Girish Nair arrived on 8 Nov 2026.",
      }),
    );
    const { user, onChanged } = setup();
    const confirm = await screen.findByRole("button", { name: "Confirm arrival" });
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(await screen.findByText("Arrival confirmed.")).toBeInTheDocument();
    expect(screen.getByText("Girish Nair arrived on 8 Nov 2026.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Confirm arrival|Mark done|Reopen/ }),
    ).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledWith("Girish Nair arrived and is now Deployed.");
  });

  it("says when there is no checklist yet", async () => {
    api.mobilization.mockResolvedValue(
      detail(0, {
        tasks: [],
        tasks_total: 0,
        can_update: false,
        update_note: "This mobilization waits for approval.",
      }),
    );
    setup();
    expect(
      await screen.findByText("The checklist starts once this mobilization is approved."),
    ).toBeInTheDocument();
  });

  it("shows the reason and a Retry when the checklist cannot be loaded", async () => {
    api.mobilization.mockRejectedValueOnce(new ApiError(500, "The checklist could not be opened."));
    api.mobilization.mockResolvedValueOnce(detail(3));
    const { user } = setup();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The checklist could not be opened.",
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("3 of 5 tasks done")).toBeInTheDocument());
  });

  it("closes from the close button", async () => {
    api.mobilization.mockResolvedValue(detail(1));
    const { user, onClose } = setup();
    await screen.findByRole("region", { name: "Operations" });
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Close/ }));
    expect(onClose).toHaveBeenCalled();
  });
});
