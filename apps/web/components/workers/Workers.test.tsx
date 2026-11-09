import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import type { WorkerDetail, WorkerFacets, WorkerList, WorkerRow } from "@/lib/api-types";

const workers = vi.fn();
const workerFacets = vi.fn();
const worker = vi.fn();
const revealNumber = vi.fn();
const editWorker = vi.fn();
const editDocumentExpiry = vi.fn();
const trades = vi.fn();
const previewWorkerEmail = vi.fn();
const sendWorkerEmail = vi.fn();
let permissions = ["employee:read", "employee:write"];

vi.mock("@/components/auth/AuthProvider", () => ({ useUser: () => ({ permissions }) }));
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
      editWorker: (code: string, body: unknown) => editWorker(code, body),
      editDocumentExpiry: (code: string, type: string, date: string) =>
        editDocumentExpiry(code, type, date),
      trades: () => trades(),
      previewWorkerEmail: (code: string, body: unknown) => previewWorkerEmail(code, body),
      sendWorkerEmail: (code: string, body: unknown) => sendWorkerEmail(code, body),
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
      project_name: "Marina Waterfront",
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
  editWorker.mockReset().mockResolvedValue({ ...DETAIL, designation: "Foreman" });
  editDocumentExpiry.mockReset().mockResolvedValue(DETAIL);
  trades.mockReset().mockResolvedValue([{ name: "Mason" }, { name: "Painter" }]);
  previewWorkerEmail.mockReset().mockResolvedValue({
    to: "worker@example.test",
    subject: "Please renew your document",
    body: "Hello Sanjeev,\n\n- Residency visa: 12 Nov 2026 (expires in 7 days)",
  });
  sendWorkerEmail
    .mockReset()
    .mockResolvedValue({ to: "worker@example.test", subject: "x", body: "y", sent: true });
  permissions = ["employee:read", "employee:write"];
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

  it("lets HR edit a worker: only the changed fields are sent, and it says so", async () => {
    window.history.replaceState(null, "", "/workers?worker=EMP-0088");
    render(<WorkersScreen />);
    const user = userEvent.setup();
    const sheet = await screen.findByRole("dialog");
    await user.click(await within(sheet).findByRole("button", { name: "Edit details" }));
    const save = within(sheet).getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled(); // nothing changed yet
    await user.type(within(sheet).getByLabelText("Designation"), "Foreman");
    expect(within(sheet).getByText("1 change")).toBeInTheDocument();
    await user.click(save);
    expect(editWorker).toHaveBeenCalledWith("EMP-0088", { designation: "Foreman" });
    expect(await within(sheet).findByRole("status")).toHaveTextContent(
      "Sanjeev Rana’s details were saved.",
    );
    expect(worker).toHaveBeenCalledTimes(2); // the profile was read again
  });

  it("shows why a change was refused and keeps what was typed", async () => {
    editWorker.mockRejectedValue(
      new ApiError(422, "Enter a phone number such as +971 50 123 4567"),
    );
    window.history.replaceState(null, "", "/workers?worker=EMP-0088");
    render(<WorkersScreen />);
    const user = userEvent.setup();
    const sheet = await screen.findByRole("dialog");
    await user.click(await within(sheet).findByRole("button", { name: "Edit details" }));
    const phone = within(sheet).getByLabelText("Phone");
    await user.clear(phone);
    await user.type(phone, "call me");
    await user.click(within(sheet).getByRole("button", { name: "Save changes" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Enter a phone number");
    expect(phone).toHaveValue("call me");
    await user.click(within(sheet).getByRole("button", { name: "Cancel" }));
    expect(within(sheet).getByRole("button", { name: "Edit details" })).toBeInTheDocument();
  });

  it("lets HR correct when a document runs out", async () => {
    window.history.replaceState(null, "", "/workers?worker=EMP-0088");
    render(<WorkersScreen />);
    const user = userEvent.setup();
    const sheet = await screen.findByRole("dialog");
    await user.click(await within(sheet).findByRole("button", { name: /Documents/ }));
    await user.click(within(sheet).getByRole("button", { name: "Change date" }));
    const field = within(sheet).getByLabelText(/expires on/);
    await user.clear(field);
    await user.type(field, "2028-02-01");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(editDocumentExpiry).toHaveBeenCalledWith("EMP-0088", "residency_visa", "2028-02-01");
    expect(await within(sheet).findByText(/runs out on 1 Feb 2028/)).toBeInTheDocument();
  });

  it("shows the exact email, then sends it and says to whom", async () => {
    worker.mockResolvedValue({ ...DETAIL, email: "worker@example.test" });
    window.history.replaceState(null, "", "/workers?worker=EMP-0088");
    render(<WorkersScreen />);
    const user = userEvent.setup();
    const sheet = await screen.findByRole("dialog");
    await user.click(await within(sheet).findByRole("button", { name: "Email worker" }));
    expect(await within(sheet).findByText(/expires in 7 days/)).toBeInTheDocument();
    expect(within(sheet).getByText("worker@example.test", { selector: "b" })).toBeInTheDocument();
    expect(previewWorkerEmail).toHaveBeenCalledWith("EMP-0088", { template: "document_renewal" });
    await user.click(within(sheet).getByRole("button", { name: "Send email" }));
    expect(sendWorkerEmail).toHaveBeenCalledWith("EMP-0088", { template: "document_renewal" });
    expect(
      await within(sheet).findByText("Email sent to worker@example.test."),
    ).toBeInTheDocument();
  });

  it("asks for an address first, saves it, and then offers the email", async () => {
    window.history.replaceState(null, "", "/workers?worker=EMP-0088");
    render(<WorkersScreen />);
    const user = userEvent.setup();
    const sheet = await screen.findByRole("dialog");
    await user.click(await within(sheet).findByRole("button", { name: "Email worker" }));
    expect(within(sheet).getByText(/has no email address yet/)).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Send email" })).toBeDisabled();
    await user.type(within(sheet).getByLabelText("Send to"), "New@Example.test");
    await user.click(within(sheet).getByRole("button", { name: "Save address" }));
    expect(editWorker).toHaveBeenCalledWith("EMP-0088", { email: "New@Example.test" });
    expect(await within(sheet).findByText(/expires in 7 days/)).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Send email" })).toBeEnabled();
  });

  it("shows why an email could not be sent", async () => {
    worker.mockResolvedValue({ ...DETAIL, email: "worker@example.test" });
    sendWorkerEmail.mockRejectedValue(
      new ApiError(502, "The mail service could not be reached. Check that n8n is running."),
    );
    window.history.replaceState(null, "", "/workers?worker=EMP-0088");
    render(<WorkersScreen />);
    const user = userEvent.setup();
    const sheet = await screen.findByRole("dialog");
    await user.click(await within(sheet).findByRole("button", { name: "Email worker" }));
    await within(sheet).findByText(/expires in 7 days/); // the email is shown, so Send is ready
    await user.click(within(sheet).getByRole("button", { name: "Send email" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Check that n8n is running");
    expect(within(sheet).getByRole("button", { name: "Send email" })).toBeEnabled(); // can try again
  });

  it("lets HR write their own message", async () => {
    worker.mockResolvedValue({ ...DETAIL, email: "worker@example.test" });
    window.history.replaceState(null, "", "/workers?worker=EMP-0088");
    render(<WorkersScreen />);
    const user = userEvent.setup();
    const sheet = await screen.findByRole("dialog");
    await user.click(await within(sheet).findByRole("button", { name: "Email worker" }));
    await user.click(within(sheet).getByLabelText("Write my own"));
    expect(within(sheet).getByRole("button", { name: "Send email" })).toBeDisabled();
    await user.type(within(sheet).getByLabelText("Subject"), "Site meeting");
    await user.type(within(sheet).getByLabelText("Message"), "Please come at 7.");
    await waitFor(() =>
      expect(previewWorkerEmail).toHaveBeenLastCalledWith("EMP-0088", {
        template: "custom",
        subject: "Site meeting",
        message: "Please come at 7.",
      }),
    );
  });

  it("offers no editing to someone who may only read", async () => {
    permissions = ["employee:read"];
    window.history.replaceState(null, "", "/workers?worker=EMP-0088");
    render(<WorkersScreen />);
    const sheet = await screen.findByRole("dialog");
    await within(sheet).findByText(/before the job on RAK-01 ends/);
    expect(within(sheet).queryByRole("button", { name: "Edit details" })).toBeNull();
    await userEvent.setup().click(within(sheet).getByRole("button", { name: /Documents/ }));
    expect(within(sheet).queryByRole("button", { name: "Change date" })).toBeNull();
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
