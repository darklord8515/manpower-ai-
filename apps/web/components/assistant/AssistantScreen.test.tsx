import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { conversation, conversationView } from "./test-data";

const api = {
  chatSuggestions: vi.fn(),
  sendChat: vi.fn(),
  chatAnswer: vi.fn(),
  conversations: vi.fn(),
  conversation: vi.fn(),
  deleteConversation: vi.fn(),
};

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: {
      ...original.api,
      chatSuggestions: (...a: unknown[]) => api.chatSuggestions(...a),
      sendChat: (...a: unknown[]) => api.sendChat(...a),
      chatAnswer: (...a: unknown[]) => api.chatAnswer(...a),
      conversations: (...a: unknown[]) => api.conversations(...a),
      conversation: (...a: unknown[]) => api.conversation(...a),
      deleteConversation: (...a: unknown[]) => api.deleteConversation(...a),
    },
  };
});

import { AssistantScreen } from "./AssistantScreen";

const TWO = [
  conversation(),
  conversation({
    id: "conv-2",
    title: "Documents ending soon",
    updated_at: "2026-11-04T08:00:00Z",
  }),
];

// A block body: an arrow that returns the mock would be run by Vitest as a cleanup function.
beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.chatSuggestions.mockResolvedValue({
    items: ["Who is available right now?"],
    ai_enabled: true,
  });
  api.conversations.mockResolvedValue(TWO);
  api.conversation.mockResolvedValue(conversationView());
  api.deleteConversation.mockResolvedValue(undefined);
});

describe("AssistantScreen", () => {
  it("lists your conversations, newest first, and opens one with its answers", async () => {
    render(<AssistantScreen />);
    expect(screen.getByRole("status", { name: "Loading your conversations" })).toBeInTheDocument();
    const nav = await screen.findByRole("navigation", { name: "Your conversations" });
    expect(within(nav).getByText("Documents ending soon")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(nav).getByRole("button", { name: /^Any free steel fixers/ }));
    expect(api.conversation).toHaveBeenCalledWith("conv-1");
    const card = await screen.findByRole("article", { name: "Answer from the Workforce agent" });
    expect(within(card).getByText("Anil Kumar")).toBeInTheDocument();
    expect(screen.getByText("Any free steel fixers?", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Any free steel fixers/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("says so when there are no conversations yet", async () => {
    api.conversations.mockResolvedValue([]);
    render(<AssistantScreen />);
    expect(await screen.findByText("No conversations yet")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ask Virtual HR" })).toBeInTheDocument();
  });

  it("shows why the list could not load, and loads it again", async () => {
    api.conversations.mockRejectedValueOnce(new ApiError(500, "The server had a problem."));
    render(<AssistantScreen />);
    expect(await screen.findByText("The server had a problem.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Documents ending soon")).toBeInTheDocument();
  });

  it("asks before deleting, then deletes and says so", async () => {
    render(<AssistantScreen />);
    const user = userEvent.setup();
    await screen.findByText("Documents ending soon");
    await user.click(
      screen.getByRole("button", { name: "Delete conversation: Documents ending soon" }),
    );
    expect(api.deleteConversation).not.toHaveBeenCalled();
    api.conversations.mockResolvedValue([TWO[0]]);
    await user.click(screen.getByRole("button", { name: "Delete?" }));
    expect(api.deleteConversation).toHaveBeenCalledWith("conv-2");
    expect(await screen.findByRole("status")).toHaveTextContent("Conversation deleted.");
    await waitFor(() =>
      expect(screen.queryByText("Documents ending soon")).not.toBeInTheDocument(),
    );
  });

  it("explains a delete that did not work", async () => {
    api.deleteConversation.mockRejectedValue(new ApiError(404, "Conversation not found"));
    render(<AssistantScreen />);
    const user = userEvent.setup();
    await screen.findByText("Documents ending soon");
    await user.click(
      screen.getByRole("button", { name: "Delete conversation: Documents ending soon" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete?" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Conversation not found");
  });

  it("starts a fresh chat", async () => {
    render(<AssistantScreen />);
    const user = userEvent.setup();
    const nav = await screen.findByRole("navigation", { name: "Your conversations" });
    await user.click(within(nav).getByRole("button", { name: /^Any free steel fixers/ }));
    await screen.findByRole("article");
    await user.click(screen.getByRole("button", { name: "New chat" }));
    expect(screen.getByRole("heading", { name: "Ask Virtual HR" })).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("says why a conversation could not be opened", async () => {
    api.conversation.mockRejectedValue(new ApiError(404, "Conversation not found"));
    render(<AssistantScreen />);
    const nav = await screen.findByRole("navigation", { name: "Your conversations" });
    await userEvent
      .setup()
      .click(within(nav).getByRole("button", { name: /^Any free steel fixers/ }));
    expect(await screen.findByText("Conversation not found")).toBeInTheDocument();
  });
});
