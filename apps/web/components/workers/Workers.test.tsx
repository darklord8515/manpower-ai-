import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import type { WorkerDetail, WorkerFacets, WorkerList, WorkerRow } from "@/lib/api-types";

const workers = vi.fn();
const workerFacets = vi.fn();
const worker = vi.fn();
const revealNumber = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: {
      ...original.api,
      workers: (...args: unknown[]) => workers(...args),
      workerFacets: () => workerFacets(),
      worker: (code: string) => worker(code),
      revealNumber: (code: string, type: string) => revealNumber(code, type),
      workersCsvUrl: () => "/api/workers/export.csv?sort=name",
    },
  };
});

import { RevealNumber } from "./RevealNumber";
import { WorkersScreen } from "./WorkersScreen";

const row = (code: string, name: string, extra: Partial<WorkerRow> = {}): WorkerRow => ({
  code,
  name,
  trade: "Mason",
  level: 3,
  status: "deployed",
  project: "RAK-01",
  phone: "+971 50 111 2222",
  next_document: { type: "residency_visa", expiry: "2026-11-12", days_left: 7 },
  ...extra,
});

const FACETS: WorkerFacets = {
  trades: [
    { value: "Mason", count: 2 },
    { value: "Painter", count: 1 },
  ],
  statuses: [
    { value: "deployed", count: 2 },
    { value: "available", count: 1 },
  ],
  projects: [{ value: "RAK-01", count: 2 }],
  documents: { expired: 1, expiring_30: 1 },
};

const LIST: WorkerList = {
  total: 3,
  items: [
    row("EMP-0088", "Sanjeev Rana"),
    row("EMP-0089", "Omar Khan"),
    row("EMP-0090", "Ali Ahmed"),
  ],
};

const DETAIL: WorkerDetail = {
  ...row("EMP-0088", "Sanjeev Rana"),
  documents: [
    {
      type: "residency_visa",
      number: "•••• 7711",
      can_reveal: true,
      expiry: "2026-11-12",
      days_left: 7,
      status: "verified",
    },
  ],
  assignments: [
    {
      project_code: "RAK-01",
      project_name: "Jebel Approach Road",
      starts: "2026-03-01",
      ends: "2027-01-31",
      status: "active",
    },
  ],
  risks: [
    {
      kind: "ends_before_assignment",
      severity: "warning",
      document_type: "residency_visa",
      expiry: "2026-11-12",
      project_code: "RAK-01",
      days_short: 80,
      message: "Residency visa ends 12 Nov 2026, before the job on RAK-01 ends (31 Jan 2027).",
    },
  ],
};

// The screen draws a table and, for phones, a card list; the table is the one to look in.
const inTable = async (name: RegExp) =>
  within(await screen.findByRole("table")).findByRole("button", { name });

beforeEach(() => {
  workers.mockReset().mockResolvedValue(LIST);
  workerFacets.mockReset().mockResolvedValue(FACETS);
  worker.mockReset().mockResolvedValue(DETAIL);
  revealNumber.mockReset().mockResolvedValue({ number: "784-1988-1234567-1" });
  window.history.replaceState(null, "", "/workers");
});

describe("Workers", () => {
  it("lists people with counts on the filters", async () => {
    render(<WorkersScreen />);
    expect(await inTable(/Sanjeev Rana/)).toBeInTheDocument();
    expect(screen.getByText("3 people")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Mason (2)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Expired (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Available · 1" })).toBeInTheDocument();
  });

  it("filters by status through the API and puts the view in the address bar", async () => {
    const user = userEvent.setup();
    render(<WorkersScreen />);
    await inTable(/Sanjeev Rana/);
    await user.click(screen.getByRole("button", { name: "Available · 1" }));
    await waitFor(() =>
      expect(workers).toHaveBeenLastCalledWith(expect.objectContaining({ status: "available" })),
    );
    expect(window.location.search).toBe("?status=available");
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("waits for a pause in typing before searching", async () => {
    const user = userEvent.setup();
    render(<WorkersScreen />);
    await inTable(/Sanjeev Rana/);
    workers.mockClear();
    await user.type(screen.getByLabelText("Search workers"), "khan");
    await waitFor(() => expect(workers).toHaveBeenCalledTimes(1));
    expect(workers).toHaveBeenLastCalledWith(expect.objectContaining({ q: "khan" }));
  });

  it("jumps to the search box on /", async () => {
    const user = userEvent.setup();
    render(<WorkersScreen />);
    await inTable(/Sanjeev Rana/);
    await user.keyboard("/");
    expect(screen.getByLabelText("Search workers")).toHaveFocus();
  });

  it("says so when nobody matches, and offers a way back", async () => {
    workers.mockResolvedValue({ total: 0, items: [] });
    window.history.replaceState(null, "", "/workers?q=zzz");
    const user = userEvent.setup();
    render(<WorkersScreen />);
    expect(await screen.findByText("No one matches")).toBeInTheDocument();
    workers.mockResolvedValue(LIST);
    await user.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    expect(await inTable(/Sanjeev Rana/)).toBeInTheDocument();
  });

  it("shows a real error with a Retry that works", async () => {
    workers.mockRejectedValueOnce(new ApiError(500, "The server had a problem."));
    const user = userEvent.setup();
    render(<WorkersScreen />);
    expect(await screen.findByText("The server had a problem.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await inTable(/Sanjeev Rana/)).toBeInTheDocument();
  });

  it("keeps working when only the filter counts fail", async () => {
    workerFacets.mockRejectedValueOnce(new ApiError(500, "no"));
    render(<WorkersScreen />);
    expect(await inTable(/Sanjeev Rana/)).toBeInTheDocument();
    expect(await screen.findByText(/filter counts couldn’t load/)).toBeInTheDocument();
  });

  it("copies the phone numbers of the ticked rows", async () => {
    const user = userEvent.setup(); // installs its own clipboard, so replace it afterwards
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<WorkersScreen />);
    await inTable(/Sanjeev Rana/);
    await user.click(screen.getByLabelText("Select row EMP-0088"));
    await user.click(screen.getByLabelText("Select row EMP-0089"));
    await user.click(screen.getByRole("button", { name: "Copy phone numbers" }));
    expect(writeText).toHaveBeenCalledWith("+971 50 111 2222\n+971 50 111 2222");
    expect(await screen.findByText("Copied 2 phone numbers.")).toBeInTheDocument();
  });

  it("opens the profile from a shared link, with the document problem spelled out", async () => {
    window.history.replaceState(null, "", "/workers?worker=EMP-0088");
    render(<WorkersScreen />);
    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByText(/before the job on RAK-01 ends/)).toBeInTheDocument();
    expect(worker).toHaveBeenCalledWith("EMP-0088");
  });

  it("hides status, project and filters from the narrow projection", async () => {
    workers.mockResolvedValue({
      total: 1,
      items: [
        row("EMP-0088", "Sanjeev Rana", {
          status: null,
          level: null,
          project: null,
          next_document: null,
        }),
      ],
    });
    render(<WorkersScreen />);
    expect(await inTable(/Sanjeev Rana/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Trade")).toBeNull();
    expect(screen.queryByRole("link", { name: /Download CSV/ })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Phone" })).toBeInTheDocument();
  });
});

describe("the eye icon", () => {
  const props = {
    workerCode: "EMP-0088",
    documentType: "residency_visa",
    label: "Emirates ID number",
    masked: "•••• 7711",
  };

  it("shows the number only after the eye is pressed, and hides it again", async () => {
    const user = userEvent.setup();
    render(<RevealNumber {...props} canReveal />);
    expect(screen.getByText("•••• 7711")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show emirates id number" }));
    expect(await screen.findByText("784-1988-1234567-1")).toBeInTheDocument();
    expect(revealNumber).toHaveBeenCalledWith("EMP-0088", "residency_visa");
    await user.click(screen.getByRole("button", { name: "Hide emirates id number" }));
    expect(screen.getByText("•••• 7711")).toBeInTheDocument();
    expect(screen.queryByText("784-1988-1234567-1")).toBeNull();
  });

  it("has no eye for someone who may not see the number", () => {
    render(<RevealNumber {...props} canReveal={false} />);
    expect(screen.getByText("•••• 7711")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says so when the API refuses", async () => {
    revealNumber.mockRejectedValueOnce(new ApiError(403, "Not allowed"));
    const user = userEvent.setup();
    render(<RevealNumber {...props} canReveal />);
    await user.click(screen.getByRole("button", { name: "Show emirates id number" }));
    expect(await screen.findByText("Not allowed")).toBeInTheDocument();
    expect(screen.getByText("•••• 7711")).toBeInTheDocument();
  });
});
