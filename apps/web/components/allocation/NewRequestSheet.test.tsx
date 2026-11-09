import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";

const raiseRequest = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: { ...original.api, raiseRequest: (...args: unknown[]) => raiseRequest(...args) },
  };
});

import { NewRequestSheet } from "./NewRequestSheet";

const PROJECTS = [
  {
    code: "RAK-07",
    name: "Falcon Villas",
    status: "planning",
    starts: "2027-02-12",
    ends: "2027-12-31",
    planned: 24,
    deployed: 0,
  },
  {
    code: "RAK-02",
    name: "Aila Homes",
    status: "completed",
    starts: "2025-01-01",
    ends: "2026-06-30",
    planned: 10,
    deployed: 10,
  },
];
const TRADES = [
  { code: "carpenter", name: "Carpenter" },
  { code: "steel_fixer", name: "Steel fixer" },
];

function setup() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <NewRequestSheet
      open
      onClose={onClose}
      projects={PROJECTS}
      trades={TRADES}
      onCreated={onCreated}
    />,
  );
  return { onClose, onCreated, user: userEvent.setup() };
}

// A block body: an arrow that returns the mock would be run by Vitest as a cleanup function.
beforeEach(() => {
  raiseRequest.mockReset();
});

describe("New staffing request", () => {
  it("shows both problems on a line and sends nothing", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(screen.getByText("Choose the project the workers are for.")).toBeInTheDocument();
    expect(screen.getByText("Choose a trade.")).toBeInTheDocument();
    expect(screen.getByText("Enter a whole number from 1 to 500.")).toBeInTheDocument();
    expect(raiseRequest).not.toHaveBeenCalled();
  });

  it("only offers projects that are still running", () => {
    setup();
    expect(screen.getByRole("option", { name: /RAK-07/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /RAK-02/ })).not.toBeInTheDocument();
  });

  it("fills in the dates from the project, and they can still be changed", async () => {
    const { user } = setup();
    await user.selectOptions(screen.getByLabelText("Project"), "RAK-07");
    expect(screen.getByLabelText("From")).toHaveValue("2027-02-12");
    expect(screen.getByLabelText("Until (optional)")).toHaveValue("2027-12-31");
  });

  it("sends the request and hands it on", async () => {
    raiseRequest.mockResolvedValue({ request_no: "SR-2026-0003" });
    const { user, onCreated } = setup();
    await user.selectOptions(screen.getByLabelText("Project"), "RAK-07");
    await user.selectOptions(screen.getByLabelText("Trade 1", { exact: true }), "steel_fixer");
    await user.type(screen.getByLabelText("How many 1"), "4");
    await user.selectOptions(screen.getByLabelText("Minimum level 1"), "3");
    await user.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ request_no: "SR-2026-0003" }));
    expect(raiseRequest).toHaveBeenCalledWith({
      project: "RAK-07",
      needed_from: "2027-02-12",
      needed_until: "2027-12-31",
      priority: 3,
      source_text: null,
      lines: [{ trade: "steel_fixer", headcount: 4, min_level: 3 }],
    });
  });

  it("shows the reason when the API refuses", async () => {
    raiseRequest.mockRejectedValue(new ApiError(422, "The start date is in the past."));
    const { user, onCreated } = setup();
    await user.selectOptions(screen.getByLabelText("Project"), "RAK-07");
    await user.selectOptions(screen.getByLabelText("Trade 1", { exact: true }), "carpenter");
    await user.type(screen.getByLabelText("How many 1"), "2");
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The start date is in the past.");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("stops the same trade being chosen twice", async () => {
    const { user } = setup();
    await user.selectOptions(screen.getByLabelText("Trade 1", { exact: true }), "carpenter");
    await user.click(screen.getByRole("button", { name: "Add a trade" }));
    const second = screen.getByLabelText("Trade 2", { exact: true });
    expect(second.querySelector('option[value="carpenter"]')).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add a trade" })).toBeDisabled(); // both trades used
  });
});
