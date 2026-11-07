import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { agentRun } from "@/components/allocation/test-data";

const api = { startAgentRun: vi.fn(), agentRun: vi.fn() };

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: {
      ...original.api,
      startAgentRun: (...a: unknown[]) => api.startAgentRun(...a),
      agentRun: (...a: unknown[]) => api.agentRun(...a),
    },
  };
});

import { ExplainPanel } from "./ExplainPanel";

const explained = agentRun({
  kind: "explain_forecast",
  recommendation: null,
  answer: "RAK-07 needs 6 people in Test trade and 4 can be deployed. Recruit 2 by 13 Jan 2027.",
  steps: [{ title: "Read the forecast", detail: "1 trade, 1 short, start 12 Feb 2027" }],
});

function setup(start = "") {
  const onClose = vi.fn();
  render(<ExplainPanel project="RAK-07" start={start} onClose={onClose} />);
  return { onClose, user: userEvent.setup() };
}

// A block body: an arrow that returns the mock would be run by Vitest as a cleanup function.
beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.startAgentRun.mockResolvedValue({ id: "run-1" });
  api.agentRun.mockResolvedValue(explained);
});

describe("ExplainPanel", () => {
  it("asks the agent to explain this project and shows its words, labelled as AI", async () => {
    setup();
    expect(await screen.findByText(/RAK-07 needs 6 people in Test trade/)).toBeInTheDocument();
    expect(api.startAgentRun).toHaveBeenCalledWith({
      kind: "explain_forecast",
      project: "RAK-07",
      start: null,
    });
    expect(screen.getByText(/Written by AI from the numbers below/)).toBeInTheDocument();
    expect(screen.getByText("Trace · 1 step")).toBeInTheDocument();
  });

  it("explains the what-if date the forecast on screen was worked out for", async () => {
    setup("2027-03-01");
    await screen.findByText(/RAK-07 needs/);
    expect(api.startAgentRun).toHaveBeenCalledWith({
      kind: "explain_forecast",
      project: "RAK-07",
      start: "2027-03-01",
    });
  });

  it("says when the words did not match the numbers, and lets the person try again", async () => {
    api.agentRun.mockResolvedValue(
      agentRun({
        kind: "explain_forecast",
        status: "failed",
        recommendation: null,
        error: "The AI’s wording did not match the numbers, so it was not used.",
      }),
    );
    const { user } = setup();
    expect(
      await screen.findByText("The agent could not explain this forecast."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The AI’s wording did not match the numbers, so it was not used."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(api.startAgentRun).toHaveBeenCalledTimes(2);
    expect(api.startAgentRun).toHaveBeenLastCalledWith({
      kind: "explain_forecast",
      project: "RAK-07",
      start: null,
    });
  });

  it("shows why it could not start", async () => {
    api.startAgentRun.mockRejectedValue(
      new ApiError(503, "The AI model is not set up on this server."),
    );
    setup();
    expect(
      await screen.findByText("The AI model is not set up on this server."),
    ).toBeInTheDocument();
  });

  it("closes", async () => {
    const { user, onClose } = setup();
    await user.click(await screen.findByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
