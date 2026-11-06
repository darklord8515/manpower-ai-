import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";

const replace = vi.fn();
let search = "";
const signIn = vi.fn();
const demoSignIn = vi.fn();
let authStatus: "loading" | "anonymous" | "signed-in" = "anonymous";
let demoEnabled = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src }: { src: string }) => <img alt="" src={src} />,
}));
vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ status: authStatus, user: null, signIn, demoSignIn, signOut: vi.fn() }),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: { ...original.api, config: () => Promise.resolve({ demo_mode: demoEnabled }) },
  };
});

import { LoginScreen } from "./LoginScreen";

async function fill(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  return user;
}

beforeEach(() => {
  replace.mockReset();
  signIn.mockReset();
  demoSignIn.mockReset();
  search = "";
  authStatus = "anonymous";
  demoEnabled = true;
});

describe("LoginScreen", () => {
  it("asks for what is missing, in words, and focuses the first problem", async () => {
    render(<LoginScreen />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveFocus();
    expect(signIn).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
  });

  it("signs in and goes to the page the visitor asked for", async () => {
    search = "next=%2Fworkers";
    signIn.mockResolvedValue({});
    render(<LoginScreen />);
    const user = await fill("noura.demo@constructiq.test", "secret");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/workers"));
    expect(signIn).toHaveBeenCalledWith("noura.demo@constructiq.test", "secret");
  });

  it("never follows a next address that leaves the site", async () => {
    search = "next=https%3A%2F%2Fevil.example";
    signIn.mockResolvedValue({});
    render(<LoginScreen />);
    const user = await fill("a@b.test", "pw");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("says the email or password is not right, clears the password and refocuses it", async () => {
    signIn.mockRejectedValue(new ApiError(401, "Email or password is not right"));
    render(<LoginScreen />);
    const user = await fill("a@b.test", "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Email or password is not right.")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Password")).toHaveFocus();
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows a lock-out countdown and disables sign in until it ends", async () => {
    signIn.mockRejectedValue(new ApiError(429, "Too many attempts", 125));
    render(<LoginScreen />);
    const user = await fill("a@b.test", "pw");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("2:05")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  });

  it("explains when the server could not be reached", async () => {
    signIn.mockRejectedValue(
      new ApiError(0, "We couldn’t reach the server. Check your connection and try again."),
    );
    render(<LoginScreen />);
    const user = await fill("a@b.test", "pw");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/couldn’t reach the server/)).toBeInTheDocument();
  });

  it("disables the button and says it is working while the request runs", async () => {
    let finish: (value: unknown) => void = () => undefined;
    signIn.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<LoginScreen />);
    const user = await fill("a@b.test", "pw");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    await act(async () => finish({}));
  });

  it("shows and hides the password", async () => {
    render(<LoginScreen />);
    const user = userEvent.setup();
    const field = screen.getByLabelText("Password");
    expect(field).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(field).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(field).toHaveAttribute("type", "password");
  });

  it("warns when Caps Lock is on", () => {
    render(<LoginScreen />);
    const field = screen.getByLabelText("Password");
    fireEvent.keyDown(field, { key: "a", modifierCapsLock: true });
    expect(screen.getByText("Caps Lock is on.")).toBeInTheDocument();
    fireEvent.keyUp(field, { key: "a", modifierCapsLock: false });
    expect(screen.queryByText("Caps Lock is on.")).not.toBeInTheDocument();
  });

  it("explains why the visitor is here when a session ended", () => {
    search = "reason=expired";
    render(<LoginScreen />);
    expect(screen.getByRole("status")).toHaveTextContent("Your session ended");
  });

  it("offers demo accounts only when the server says demo mode is on", async () => {
    render(<LoginScreen />);
    expect(await screen.findByRole("button", { name: /HR Manager/ })).toBeInTheDocument();
    demoSignIn.mockResolvedValue({});
    await userEvent.setup().click(screen.getByRole("button", { name: /MD \/ CEO/ }));
    await waitFor(() => expect(demoSignIn).toHaveBeenCalledWith("ceo"));
  });

  it("hides demo accounts when demo mode is off", async () => {
    demoEnabled = false;
    render(<LoginScreen />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("Demo accounts")).not.toBeInTheDocument();
  });

  it("forwards a visitor who is already signed in", () => {
    authStatus = "signed-in";
    search = "next=%2Fworkers";
    render(<LoginScreen />);
    expect(replace).toHaveBeenCalledWith("/workers");
  });

  it("has no forgot-password button (resets come with email, later)", () => {
    render(<LoginScreen />);
    expect(screen.queryByRole("button", { name: /forgot/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Ask your administrator/)).toBeInTheDocument();
  });
});
