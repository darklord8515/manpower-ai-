import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { approval } from "./test-data";

const approveLine = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: { ...original.api, approveLine: (...args: unknown[]) => approveLine(...args) },
  };
});

import { ApprovalDialog } from "./ApprovalDialog";

function setup() {
  const onApproved = vi.fn();
  const onClose = vi.fn();
  render(
    <ApprovalDialog
      requestNo="SR-2026-0001"
      lineId="line-1"
      trade="Steel fixer"
      onApproved={onApproved}
      onClose={onClose}
    />,
  );
  return { onApproved, onClose, user: userEvent.setup() };
}

// A block body: an arrow that returns the mock would be run by Vitest as a cleanup function.
beforeEach(() => {
  approveLine.mockReset();
});

describe("ApprovalDialog", () => {
  it("asks for a preview first, which writes nothing, and says what will happen", async () => {
    approveLine.mockResolvedValue(approval());
    setup();
    expect(screen.getByRole("status", { name: "Checking the line" })).toBeInTheDocument();
    expect(await screen.findByText("Imran Qureshi")).toBeInTheDocument();
    expect(approveLine).toHaveBeenCalledWith("SR-2026-0001", "line-1", true);
    expect(screen.getByText("Becomes Mobilizing now.", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/after finishing on RAK-05 \(20 Nov 2026\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/2 assignments planned, 2 mobilizations started\./),
    ).toBeInTheDocument();
    expect(screen.getByText("1 depends on another job finishing on time.")).toBeInTheDocument();
    expect(screen.getByText(/The line will be 2 of 3\./)).toBeInTheDocument();
    expect(screen.getByText(/the gap stays open/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve 2 workers" })).toBeEnabled();
  });

  it("approves for real when confirmed, then hands the result on", async () => {
    const done = approval({ preview: false });
    approveLine.mockResolvedValueOnce(approval()).mockResolvedValueOnce(done);
    const { user, onApproved } = setup();
    await user.click(await screen.findByRole("button", { name: "Approve 2 workers" }));
    await waitFor(() => expect(onApproved).toHaveBeenCalledWith(done));
    expect(approveLine).toHaveBeenLastCalledWith("SR-2026-0001", "line-1", false);
  });

  it("when the rules block someone, names them and cannot be confirmed", async () => {
    const blocked = approval({ ok: false });
    blocked.people[0].violations = [
      { rule: "DOC_VALID_THROUGH", message: "Residency visa ends 12 Jan 2027" },
    ];
    approveLine.mockResolvedValue(blocked);
    setup();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Someone no longer passes the rules",
    );
    expect(screen.getByText("DOC_VALID_THROUGH")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve 2 workers" })).toBeDisabled();
    expect(screen.queryByText(/assignments planned/)).not.toBeInTheDocument();
  });

  it("shows the blocking reasons if the rules change between the preview and the confirm", async () => {
    const blocked = approval({ ok: false, preview: false });
    blocked.people[1].violations = [{ rule: "ASSIGN_OVERLAP", message: "Now on RAK-02" }];
    approveLine.mockResolvedValueOnce(approval()).mockResolvedValueOnce(blocked);
    const { user, onApproved } = setup();
    await user.click(await screen.findByRole("button", { name: "Approve 2 workers" }));
    expect(await screen.findByText("ASSIGN_OVERLAP")).toBeInTheDocument();
    expect(onApproved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Approve 2 workers" })).toBeDisabled();
  });

  it("shows the API's reason when the preview fails", async () => {
    approveLine.mockRejectedValue(new ApiError(403, "Approving needs the HR Manager."));
    setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("Approving needs the HR Manager.");
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  it("closes on Cancel and on Esc without approving", async () => {
    approveLine.mockResolvedValue(approval());
    const { user, onClose } = setup();
    await screen.findByText("Imran Qureshi");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(approveLine).not.toHaveBeenCalledWith("SR-2026-0001", "line-1", false);
  });
});
