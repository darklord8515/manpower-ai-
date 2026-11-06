import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";

const createProject = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: { ...original.api, createProject: (...args: unknown[]) => createProject(...args) },
  };
});

import { AddProjectSheet } from "./AddProjectSheet";

const TRADES = [
  { code: "carpenter", name: "Carpenter" },
  { code: "mason", name: "Mason" },
];

function setup() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(<AddProjectSheet open onClose={onClose} trades={TRADES} onCreated={onCreated} />);
  return { onClose, onCreated, user: userEvent.setup() };
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Project name"), "Marina Towers");
  await user.type(screen.getByLabelText("Starts"), "2027-04-01");
  await user.type(screen.getByLabelText("Ends"), "2028-03-31");
  await user.selectOptions(screen.getByLabelText("Trade 1", { exact: true }), "mason");
  await user.type(screen.getByLabelText("How many 1"), "12");
}

beforeEach(() => createProject.mockReset());

describe("Add a project", () => {
  it("explains every mistake and sends nothing", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Create project" }));
    expect(
      screen.getByText("Give the project a name of at least 3 characters."),
    ).toBeInTheDocument();
    expect(screen.getByText("Choose a start and an end date.")).toBeInTheDocument();
    expect(screen.getByText("Choose a trade.")).toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("sends the project and hands the new project on", async () => {
    createProject.mockResolvedValue({ code: "RAK-08", name: "Marina Towers" });
    const { user, onCreated } = setup();
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({ code: "RAK-08", name: "Marina Towers" }),
    );
    expect(createProject).toHaveBeenCalledWith({
      name: "Marina Towers",
      starts_on: "2027-04-01",
      ends_on: "2028-03-31",
      outdoor: true,
      lines: [{ trade: "mason", headcount: 12 }],
    });
  });

  it("shows why the server refused, and lets the person try again", async () => {
    createProject.mockRejectedValueOnce(new ApiError(422, "Unknown trade: mason"));
    const { user, onCreated } = setup();
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByText("Unknown trade: mason")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create project" })).toBeEnabled();
  });

  it("offers each trade once", async () => {
    const { user } = setup();
    await user.selectOptions(screen.getByLabelText("Trade 1", { exact: true }), "mason");
    await user.click(screen.getByRole("button", { name: "Add a trade" }));
    expect(
      screen.getByLabelText("Trade 2", { exact: true }).querySelector('option[value="mason"]'),
    ).toBeDisabled();
    // Both trades are now in use, so there is nothing more to add.
    await user.selectOptions(screen.getByLabelText("Trade 2", { exact: true }), "carpenter");
    expect(screen.getByRole("button", { name: "Add a trade" })).toBeDisabled();
  });
});
