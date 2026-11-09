import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssistantLauncher, showLauncher } from "./AssistantLauncher";

describe("showLauncher", () => {
  it("shows for someone who may ask, on an ordinary page, with the drawer closed", () => {
    expect(showLauncher({ canAsk: true, pathname: "/", open: false })).toBe(true);
    expect(showLauncher({ canAsk: true, pathname: "/projects/RAK-07", open: false })).toBe(true);
  });

  it("is hidden on the Virtual HR page, without permission, and while the drawer is open", () => {
    expect(showLauncher({ canAsk: true, pathname: "/assistant", open: false })).toBe(false);
    expect(showLauncher({ canAsk: true, pathname: "/assistant/abc", open: false })).toBe(false);
    expect(showLauncher({ canAsk: false, pathname: "/", open: false })).toBe(false);
    expect(showLauncher({ canAsk: true, pathname: "/", open: true })).toBe(false);
  });
});

describe("AssistantLauncher", () => {
  it("is a named button that opens the assistant", async () => {
    const onOpen = vi.fn();
    render(<AssistantLauncher onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: "Chat with Virtual HR" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
