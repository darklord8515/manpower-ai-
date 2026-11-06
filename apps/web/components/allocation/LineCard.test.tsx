import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { line, pick } from "./test-data";

const api = {
  suggestPeople: vi.fn(),
  removePerson: vi.fn(),
  restorePerson: vi.fn(),
  rejectLine: vi.fn(),
};

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: {
      ...original.api,
      suggestPeople: (...a: unknown[]) => api.suggestPeople(...a),
      removePerson: (...a: unknown[]) => api.removePerson(...a),
      restorePerson: (...a: unknown[]) => api.restorePerson(...a),
      rejectLine: (...a: unknown[]) => api.rejectLine(...a),
    },
  };
});

import { LineCard } from "./LineCard";

function setup(props: Partial<React.ComponentProps<typeof LineCard>> = {}) {
  const onChanged = vi.fn();
  const onApprove = vi.fn();
  const onSwap = vi.fn();
  render(
    <LineCard
      requestNo="SR-2026-0001"
      line={line({ picks: [pick("EMP-0107", "Imran Qureshi"), pick("EMP-0112", "Saleem Akhtar")] })}
      requestOpen
      canPrepare
      canApprove
      approveNote={null}
      active
      onActivate={() => {}}
      excluded={null}
      swapping={null}
      onSwap={onSwap}
      onChanged={onChanged}
      onApprove={onApprove}
      {...props}
    />,
  );
  return { onChanged, onApprove, onSwap, user: userEvent.setup() };
}

beforeEach(() => Object.values(api).forEach((fn) => fn.mockReset()));

describe("LineCard header and approval", () => {
  it("counts the chosen against the headcount and offers to approve them", async () => {
    const { user, onApprove } = setup();
    expect(screen.getByText(/Level 2 or higher · 2 of 3 selected/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve 2 workers" }));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(screen.getByText("1 open slot: choose from the pool")).toBeInTheDocument();
  });

  it("cannot approve an empty line, and says why", () => {
    setup({ line: line() });
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByText("Choose at least one worker first.")).toBeInTheDocument();
  });

  it("cannot approve while someone chosen no longer passes the rules", () => {
    setup({
      line: line({
        picks: [
          pick("EMP-0107", "Imran Qureshi", {
            violations: [{ rule: "ASSIGN_OVERLAP", message: "Now on RAK-02" }],
          }),
        ],
      }),
    });
    expect(screen.getByRole("button", { name: "Approve 1 worker" })).toBeDisabled();
    expect(screen.getByText("Fix or remove the highlighted workers first.")).toBeInTheDocument();
  });

  it("shows the reason instead of Approve and Reject to someone who cannot approve", () => {
    setup({ canApprove: false, approveNote: "Approving needs the HR Manager." });
    expect(screen.getByText("Approving needs the HR Manager.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve|Reject/ })).not.toBeInTheDocument();
  });

  it("shows no way to change the line without permission to prepare", () => {
    setup({ canPrepare: false });
    expect(screen.queryByRole("button", { name: "Suggest people" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Swap|Remove/ })).not.toBeInTheDocument();
    expect(screen.getByText("Imran Qureshi")).toBeInTheDocument();
  });

  it("locks an approved line and lists the mobilization numbers", () => {
    setup({
      line: line({
        status: "approved",
        filled: 1,
        decided_by: "Noura Demo",
        decided_at: "2026-11-06T09:00:00Z",
        approved: [
          {
            code: "EMP-0107",
            name: "Imran Qureshi",
            starts_on: "2026-11-08",
            moving_from: "RAK-05",
            mob_no: "MOB-2026-0001",
          },
        ],
      }),
    });
    expect(screen.getByText(/Approved by Noura Demo on 6 Nov 2026\./)).toBeInTheDocument();
    expect(screen.getByText("MOB-2026-0001")).toBeInTheDocument();
    expect(screen.getByText(/Starts 8 Nov 2026, after RAK-05/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows who rejected a line and why", () => {
    setup({
      line: line({
        status: "rejected",
        decided_by: "Noura Demo",
        decided_at: "2026-11-06T09:00:00Z",
        decision_reason: "Budget not approved yet",
      }),
    });
    expect(
      screen.getByText("Rejected by Noura Demo on 6 Nov 2026: Budget not approved yet"),
    ).toBeInTheDocument();
  });

  it("treats a closed request as read-only even if the line is still open", () => {
    setup({ requestOpen: false });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("lists who the rules left out, with the rule code, on the active line", () => {
    setup({
      excluded: [
        {
          code: "EMP-0111",
          name: "Bilal Ahmed",
          rule: "DOC_VALID_THROUGH",
          message: "Residency visa ends 12 Jan 2027",
        },
      ],
    });
    expect(screen.getByText("Left out by the rules (1)")).toBeInTheDocument();
    expect(screen.getByText("DOC_VALID_THROUGH")).toBeInTheDocument();
  });
});

describe("LineCard changes", () => {
  it("asks the rules to suggest people and reports how many", async () => {
    api.suggestPeople.mockResolvedValue({ results: [], chosen: 1 });
    const { user, onChanged } = setup();
    await user.click(screen.getByRole("button", { name: "Suggest people" }));
    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith(
        "1 worker suggested by the rules. Check them, then approve.",
      ),
    );
    expect(api.suggestPeople).toHaveBeenCalledWith("SR-2026-0001", "line-1");
  });

  it("says so when the rules find no one", async () => {
    api.suggestPeople.mockResolvedValue({ results: [], chosen: 0 });
    const { user, onChanged } = setup();
    await user.click(screen.getByRole("button", { name: "Suggest people" }));
    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith("No one else is cleared for the open places."),
    );
  });

  it("needs a reason of 3 characters before it removes anyone, then removes each selected worker", async () => {
    api.removePerson.mockResolvedValue(undefined);
    const { user, onChanged } = setup();
    await user.click(screen.getByLabelText("Select Imran Qureshi"));
    await user.click(screen.getByLabelText("Select Saleem Akhtar"));
    await user.click(screen.getByRole("button", { name: "Remove selected (2)" }));
    const submit = screen.getByRole("button", { name: "Remove 2 workers" });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/Why 2 workers are taken off/), "ok");
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/Why 2 workers are taken off/), "ay then");
    await user.click(submit);
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("Removed 2 workers."));
    expect(api.removePerson).toHaveBeenNthCalledWith(
      1,
      "SR-2026-0001",
      "line-1",
      "EMP-0107",
      "okay then",
    );
    expect(api.removePerson).toHaveBeenNthCalledWith(
      2,
      "SR-2026-0001",
      "line-1",
      "EMP-0112",
      "okay then",
    );
  });

  it("closes the remove form on Esc", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Remove Imran Qureshi" }));
    expect(screen.getByLabelText(/Why 1 worker is taken off/)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText(/Why 1 worker is taken off/)).not.toBeInTheDocument();
  });

  it("explains a refused restore on that worker and does not reload", async () => {
    api.restorePerson.mockResolvedValue({
      results: [
        {
          code: "EMP-0142",
          name: "Zubair Ali",
          outcome: "refused",
          violations: [{ rule: "ASSIGN_OVERLAP", message: "Already on RAK-02" }],
        },
      ],
      chosen: 0,
    });
    const { user, onChanged } = setup({
      line: line({ picks: [pick("EMP-0142", "Zubair Ali", { removed_reason: "Swapped" })] }),
    });
    await user.click(screen.getByRole("button", { name: "Restore Zubair Ali" }));
    expect(await screen.findByText("ASSIGN_OVERLAP")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("rejects a line only with a reason of at least 10 characters", async () => {
    api.rejectLine.mockResolvedValue({});
    const { user, onChanged } = setup();
    await user.click(screen.getByRole("button", { name: "Reject line" }));
    const form = within(screen.getByRole("form", { name: "Reject the steel fixer line" }));
    const submit = form.getByRole("button", { name: "Reject line" });
    await user.type(form.getByLabelText("Why is this line rejected?"), "Too short");
    expect(form.getByText("9 of 10 characters")).toBeInTheDocument();
    expect(submit).toBeDisabled();
    await user.type(form.getByLabelText("Why is this line rejected?"), "!!");
    await user.click(submit);
    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith("The steel fixer line was rejected."),
    );
    expect(api.rejectLine).toHaveBeenCalledWith("SR-2026-0001", "line-1", "Too short!!");
  });

  it("shows the API's message when a change fails", async () => {
    api.suggestPeople.mockRejectedValue(new ApiError(409, "SR-2026-0001 is cancelled."));
    const { user, onChanged } = setup();
    await user.click(screen.getByRole("button", { name: "Suggest people" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("SR-2026-0001 is cancelled.");
    expect(onChanged).not.toHaveBeenCalled();
  });
});
