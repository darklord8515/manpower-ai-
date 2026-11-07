import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { agentRun, recommendation, selection } from "./test-data";

const api = { startAgentRun: vi.fn(), agentRun: vi.fn(), choosePeople: vi.fn() };

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: {
      ...original.api,
      startAgentRun: (...a: unknown[]) => api.startAgentRun(...a),
      agentRun: (...a: unknown[]) => api.agentRun(...a),
      choosePeople: (...a: unknown[]) => api.choosePeople(...a),
    },
  };
});

import { AgentPanel } from "./AgentPanel";
import { line } from "./test-data";

function setup(alreadyChosen: string[] = []) {
  const onApplied = vi.fn();
  const onClose = vi.fn();
  render(
    <AgentPanel
      requestNo="SR-2026-0001"
      line={line()}
      alreadyChosen={alreadyChosen}
      onApplied={onApplied}
      onClose={onClose}
    />,
  );
  return { onApplied, onClose, user: userEvent.setup() };
}

// A block body: an arrow that returns the mock would be run by Vitest as a cleanup function.
beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.startAgentRun.mockResolvedValue({ id: "run-1" });
  api.agentRun.mockResolvedValue(agentRun());
});

describe("AgentPanel", () => {
  it("asks the agent about this line, then shows what it did and who it recommends", async () => {
    setup();
    expect(
      await screen.findByText("Recommends 2 workers, 1 place stays open."),
    ).toBeInTheDocument();
    expect(api.startAgentRun).toHaveBeenCalledWith({
      kind: "recommend_line",
      request_no: "SR-2026-0001",
      line_id: "line-1",
    });
    const list = screen.getByRole("list", { name: "Recommended workers" });
    expect(within(list).getByText("Imran Qureshi")).toBeInTheDocument();
    expect(within(list).getAllByText("Free now, level 3")).toHaveLength(2);
    expect(screen.getByText("Trace · 3 steps")).toBeInTheDocument();
  });

  it("shows its steps as they come in, then the answer", async () => {
    api.agentRun
      .mockResolvedValueOnce(
        agentRun({ status: "running", recommendation: null, steps: agentRun().steps.slice(0, 1) }),
      )
      .mockResolvedValue(agentRun());
    setup();
    expect(await screen.findByText("Read the request line")).toBeInTheDocument();
    expect(screen.getByText("Workforce agent is working…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use these/ })).not.toBeInTheDocument();
    expect(
      await screen.findByText("Recommends 2 workers, 1 place stays open.", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use these 2" })).toBeInTheDocument();
  });

  it("uses the recommendation: the choices are sent with the run, and the line is told", async () => {
    api.choosePeople.mockResolvedValue({ results: [], chosen: 2 });
    const { user, onApplied } = setup();
    await user.click(await screen.findByRole("button", { name: "Use these 2" }));
    expect(api.choosePeople).toHaveBeenCalledWith(
      "SR-2026-0001",
      "line-1",
      ["EMP-0107", "EMP-0112"],
      "run-1",
    );
    expect(onApplied).toHaveBeenCalledWith(
      "2 workers chosen from the Workforce agent’s recommendation. Check them, then approve.",
    );
    expect(await screen.findByText("2 workers added to the line.")).toBeInTheDocument();
    // They are on the line now, so the card stops listing them a second time.
    expect(screen.queryByRole("list", { name: "Recommended workers" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use these/ })).not.toBeInTheDocument();
  });

  it("does not offer people who were chosen in the meantime", async () => {
    setup(["EMP-0107"]);
    expect(await screen.findByRole("button", { name: "Use these 1" })).toBeInTheDocument();
  });

  it("says who the rules dropped from the recommendation, and why", async () => {
    api.agentRun.mockResolvedValue(
      agentRun({
        recommendation: recommendation({
          rejected: [
            {
              code: "EMP-0099",
              name: "Omar Said",
              rule: "POLICY_LATE",
              message: "Would start late.",
            },
          ],
        }),
      }),
    );
    setup();
    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent("Dropped by the rules (1)");
    expect(note).toHaveTextContent("Omar Said");
    expect(note).toHaveTextContent("POLICY_LATE");
  });

  it("marks a reason that the rules worded instead of the model", async () => {
    api.agentRun.mockResolvedValue(
      agentRun({
        recommendation: recommendation({
          selections: [selection("EMP-0107", "Imran Qureshi", { reason_by: "rules" })],
        }),
      }),
    );
    setup();
    expect(await screen.findByText(/reason worded by the rules/)).toBeInTheDocument();
  });

  it("says plainly when no one is cleared, and offers no way to apply nothing", async () => {
    api.agentRun.mockResolvedValue(
      agentRun({ recommendation: recommendation({ selections: [], shortfall: 3 }) }),
    );
    setup();
    expect(await screen.findByText("No one is cleared for the open places.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use these/ })).not.toBeInTheDocument();
  });

  it("shows what the rules refused when the choices are applied, and still tells the line", async () => {
    api.choosePeople.mockResolvedValue({
      chosen: 1,
      results: [
        {
          code: "EMP-0112",
          name: "Saleem Akhtar",
          outcome: "refused",
          violations: [{ rule: "ASSIGN_AVAILABILITY", message: "Not available for these dates." }],
        },
      ],
    });
    const { user, onApplied } = setup();
    await user.click(await screen.findByRole("button", { name: "Use these 2" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "1 person could not be chosen. Saleem Akhtar: Not available for these dates.",
    );
    expect(onApplied).toHaveBeenCalled();
  });

  it("shows the reason when applying fails", async () => {
    api.choosePeople.mockRejectedValue(new ApiError(409, "SR-2026-0001 is cancelled."));
    const { user, onApplied } = setup();
    await user.click(await screen.findByRole("button", { name: "Use these 2" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("SR-2026-0001 is cancelled.");
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("explains a run that did not finish, and runs it again on request", async () => {
    api.agentRun.mockResolvedValue(
      agentRun({
        status: "failed",
        recommendation: null,
        error: "The AI model did not give a usable answer. Try again.",
      }),
    );
    const { user } = setup();
    expect(await screen.findByText("The agent could not finish.")).toBeInTheDocument();
    expect(
      screen.getByText("The AI model did not give a usable answer. Try again."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(api.startAgentRun).toHaveBeenCalledTimes(2);
  });

  it("shows why the agent could not be started", async () => {
    api.startAgentRun.mockRejectedValue(
      new ApiError(503, "The AI model is not set up on this server."),
    );
    setup();
    expect(await screen.findByText("The agent could not finish.")).toBeInTheDocument();
    expect(screen.getByText("The AI model is not set up on this server.")).toBeInTheDocument();
  });

  it("closes", async () => {
    const { user, onClose } = setup();
    await user.click(await screen.findByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
