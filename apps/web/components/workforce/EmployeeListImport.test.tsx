import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmpImportSummary } from "@/lib/api-types";

const api = { importEmployees: vi.fn() };
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: {
      ...original.api,
      importEmployees: (...a: unknown[]) => api.importEmployees(...a),
    },
  };
});

import { ApiError } from "@/lib/api";
import { EmployeeListImport } from "./EmployeeListImport";

const PREVIEW: EmpImportSummary = {
  rows: 4,
  new: 1,
  new_staff: 0,
  new_labour: 1,
  unchanged: 2,
  ai_placed: 0,
  new_roles: [],
  overflow: [],
  issues: [],
  applied: null,
  conflicts: [
    {
      row: 4,
      kind: "moved",
      person_code: "DEMO-S-001",
      person_name: "Yasmin Demo",
      question: "Yasmin Demo is already here on Marina Waterfront. What is this?",
      options: [
        { id: "transfer", label: "It is a transfer" },
        { id: "another", label: "It is another person" },
        { id: "ignore", label: "It is a mistake: ignore this row" },
      ],
    },
  ],
};

const APPLIED = {
  created: { staff: 0, labour: 1 },
  unchanged: 2,
  transferred: 1,
  updated: 0,
  ignored: 0,
  another: 0,
  plans_raised: 0,
  ai_placed: 0,
  skipped: [],
  blocked: [],
};

beforeEach(() => api.importEmployees.mockReset());

async function chooseFile() {
  const user = userEvent.setup();
  const file = new File(["x"], "people.xlsx");
  await user.upload(screen.getByLabelText("Choose the Excel file"), file);
  await user.click(screen.getByRole("button", { name: "Preview" }));
  return user;
}

describe("EmployeeListImport", () => {
  it("asks each question and only imports once all are answered", async () => {
    const onChanged = vi.fn();
    api.importEmployees
      .mockResolvedValueOnce(PREVIEW)
      .mockResolvedValueOnce({ ...PREVIEW, applied: APPLIED });
    render(<EmployeeListImport onChanged={onChanged} />);
    const user = await chooseFile();

    expect(await screen.findByText(/Yasmin Demo is already here/)).toBeInTheDocument();
    const importButton = screen.getByRole("button", { name: "Import" });
    expect(importButton).toBeDisabled();
    expect(screen.getByText("Answer 1 more question to continue.")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "It is a transfer" }));
    expect(importButton).toBeEnabled();
    await user.click(importButton);

    expect(api.importEmployees).toHaveBeenLastCalledWith(
      expect.any(File),
      { "4": "transfer" },
      true,
      false,
    );
    expect(await screen.findByText(/Added 0 staff and 1 labour/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("says so when everyone is already there", async () => {
    api.importEmployees.mockResolvedValueOnce({
      ...PREVIEW,
      new: 0,
      new_labour: 0,
      unchanged: 4,
      conflicts: [],
    });
    render(<EmployeeListImport onChanged={vi.fn()} />);
    await chooseFile();
    expect(await screen.findByText(/already here, so there is nothing to add/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
  });

  it("shows the server's plain message when the file is not usable", async () => {
    api.importEmployees.mockRejectedValueOnce(
      new ApiError(422, "That is not an Excel (.xlsx) file."),
    );
    render(<EmployeeListImport onChanged={vi.fn()} />);
    await chooseFile();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That is not an Excel (.xlsx) file.",
    );
  });
});
