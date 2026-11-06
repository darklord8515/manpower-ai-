import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, safeNext, setSessionEndedHandler } from "./api";

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  setSessionEndedHandler(null);
});

describe("safeNext (where to go after signing in)", () => {
  it.each([
    ["/", "/"],
    ["/workers?trade=mason", "/workers?trade=mason"],
    [null, "/"],
    ["", "/"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["javascript:alert(1)", "/"],
    ["/login?next=/", "/"],
  ])("%s -> %s", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});

describe("api", () => {
  it("sends requests to the same site under /api, with the session cookie", async () => {
    reply(200, { demo_mode: true });
    await api.config();
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/auth/config");
    expect((init as RequestInit).credentials).toBe("same-origin");
  });

  it("sends the sign-in as JSON", async () => {
    reply(200, { full_name: "Noura Demo" });
    await api.login("a@b.test", "pw");
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      email: "a@b.test",
      password: "pw",
    });
  });

  it("turns an error body into an ApiError with the server's message", async () => {
    reply(401, { detail: "Email or password is not right" });
    await expect(api.login("a@b.test", "x")).rejects.toMatchObject({
      status: 401,
      message: "Email or password is not right",
    });
  });

  it("reads Retry-After from a lock-out", async () => {
    reply(429, { detail: "Too many attempts. Try again later." }, { "Retry-After": "840" });
    const error = await api.login("a@b.test", "x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).retryAfter).toBe(840);
  });

  it("says so plainly when the server cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    await expect(api.summary()).rejects.toMatchObject({ status: 0 });
  });

  it("treats 204 as success with no body", async () => {
    reply(204, null);
    await expect(api.logout()).resolves.toBeUndefined();
  });

  it("tells the app when a session ends (401 on a data request) but not on the sign-in calls", async () => {
    const ended = vi.fn();
    setSessionEndedHandler(ended);
    reply(401, { detail: "Sign in to continue" });
    await api.summary().catch(() => undefined);
    expect(ended).toHaveBeenCalledTimes(1);
    reply(401, { detail: "Email or password is not right" });
    await api.login("a@b.test", "x").catch(() => undefined);
    await api.me().catch(() => undefined);
    expect(ended).toHaveBeenCalledTimes(1);
  });
});
