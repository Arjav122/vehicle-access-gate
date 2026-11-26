// Who is signed in. The signed-in user is a normal TanStack query (["me"]).
// Signing in writes the new user INTO that query (setQueryData) instead of clearing the cache:
// clearing it made demo role switching flash and refetch everything (brief §17).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { api, ApiError, unwrap, type Schemas } from "@/lib/api";
import { absoluteUrl, getTokens, onTokensChange, setTokens } from "@/lib/auth";

export type Me = Schemas["Me"];
export type Role = Me["role"];

export const HOME: Record<Role, string> = {
  admin: "/admin",
  guard: "/guard",
  resident: "/resident",
};

/** Re-renders when tokens appear or disappear (sign in, sign out, refresh failure). */
export function useSignedIn(): boolean {
  return useSyncExternalStore(onTokensChange, () => getTokens() !== null);
}

export function useMe() {
  const signedIn = useSignedIn();
  return useQuery({
    queryKey: ["me"],
    queryFn: () => unwrap(api.GET("/api/me")),
    enabled: signedIn,
    staleTime: 5 * 60_000,
  });
}

export function useSignIn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const pair = await unwrap(api.POST("/api/auth/login", { body: input }));
      setTokens({ accessToken: pair.accessToken, refreshToken: pair.refreshToken });
      return unwrap(api.GET("/api/me"));
    },
    onSuccess: (me) => {
      // Previous user's lists must not show for the new one: drop everything except "me",
      // then put the new user in place (no flash of "signed out").
      client.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      client.setQueryData(["me"], me);
    },
  });
}

export function useSignOut() {
  const client = useQueryClient();
  return () => {
    const t = getTokens();
    setTokens(null);
    client.removeQueries();
    if (t) {
      // Revoke the refresh token on the server; signing out locally never waits for it.
      void fetch(absoluteUrl("/api/auth/logout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: t.refreshToken }),
      }).catch(() => undefined);
    }
  };
}

/** Demo logins, or null when demo mode is off (GET /api/demo answers 404). */
export function useDemo() {
  return useQuery({
    queryKey: ["demo"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/demo");
      if (response.status === 404) return null; // demo mode is off
      if (!response.ok || !data) throw new ApiError(response.status, "Demo info unavailable");
      return data;
    },
    staleTime: Infinity,
    retry: 3,
    // While a demo reset runs, check every 5 s so the page knows when signing in works again.
    refetchInterval: (q) => (q.state.data?.resetting ? 5000 : false),
  });
}
