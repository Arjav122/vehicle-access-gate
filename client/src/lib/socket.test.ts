// The real-time connection: events invalidate the right queries, a reconnect refetches
// everything (events sent while offline are lost), and an expired token is refreshed.
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => void;
interface FakeSocket {
  handlers: Map<string, Handler>;
  connect: () => void;
  disconnect: () => void;
  /** What the client passed as `auth` (a callback that supplies the current token). */
  authArg: unknown;
}
const fake: FakeSocket = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  authArg: null,
}));

vi.mock("socket.io-client", () => ({
  io: (opts: { auth: unknown }) => {
    fake.authArg = opts.auth;
    return {
      on: (event: string, handler: Handler) => {
        fake.handlers.set(event, handler);
      },
      connect: fake.connect,
      disconnect: fake.disconnect,
    };
  },
}));

const refresh = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
vi.mock("./auth", () => ({
  getTokens: () => ({ accessToken: "current-token", refreshToken: "r" }),
  refresh,
}));

const { connectRealtime } = await import("./socket");

afterEach(() => {
  fake.handlers.clear();
  vi.clearAllMocks();
});

const fire = (event: string, ...args: unknown[]) => {
  const h = fake.handlers.get(event);
  if (!h) throw new Error(`no handler for ${event}`);
  h(...args);
};

describe("connectRealtime", () => {
  it("sends the current access token on every (re)connect", () => {
    connectRealtime(new QueryClient(), vi.fn(), vi.fn());
    const cb = vi.fn();
    (fake.authArg as (cb: (d: unknown) => void) => void)(cb);
    expect(cb).toHaveBeenCalledWith({ token: "current-token" });
  });

  it("invalidates the queries an event affects and passes the event on", () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const onEvent = vi.fn();
    connectRealtime(client, onEvent, vi.fn());
    const event = { type: "approval.decided", at: "", data: {} };
    fire("approval.decided", event);
    const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
    expect(keys).toEqual(expect.arrayContaining(["visits", "approvals", "inside"]));
    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("refetches everything after a reconnect, not after the first connect", () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const onState = vi.fn();
    connectRealtime(client, vi.fn(), onState);
    expect(onState).toHaveBeenLastCalledWith("connecting");
    fire("connect");
    expect(invalidate).not.toHaveBeenCalled();
    expect(onState).toHaveBeenLastCalledWith("live");
    fire("disconnect");
    expect(onState).toHaveBeenLastCalledWith("offline");
    fire("connect");
    expect(invalidate).toHaveBeenCalledWith();
  });

  it("refreshes an expired token and tries again", async () => {
    connectRealtime(new QueryClient(), vi.fn(), vi.fn());
    fire("connect_error", new Error("unauthorized"));
    await vi.waitFor(() => {
      expect(fake.connect).toHaveBeenCalled();
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("disconnects when the returned function is called (sign-out, unmount)", () => {
    const stop = connectRealtime(new QueryClient(), vi.fn(), vi.fn());
    stop();
    expect(fake.disconnect).toHaveBeenCalled();
  });
});
