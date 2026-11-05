import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { DetailSheet } from "./DetailSheet";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open alert
      </button>
      <DetailSheet
        open={open}
        onOpenChange={setOpen}
        title="RAK-07 shortfall"
        meta={<span>AL-1044</span>}
        footer="Footer note"
      >
        <p>Body text</p>
      </DetailSheet>
    </>
  );
}

describe("DetailSheet", () => {
  it("opens as a labelled dialog with the title, meta, body and footer", async () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Open alert" }));
    const dialog = await screen.findByRole("dialog", { name: "RAK-07 shortfall" });
    expect(dialog).toHaveTextContent("AL-1044");
    expect(dialog).toHaveTextContent("Body text");
    expect(dialog).toHaveTextContent("Footer note");
  });

  it("moves focus into the sheet when it opens", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open alert" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it("closes on Esc and returns focus to what opened it", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open alert" });
    await userEvent.click(opener);
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Radix hands focus back a tick after the sheet unmounts.
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("closes with the close button", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open alert" }));
    await userEvent.click(await screen.findByRole("button", { name: "Close RAK-07 shortfall" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
