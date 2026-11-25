// App-wide state shared by the providers and the screens: the query client factory, the
// theme context and the real-time connection state.
import { QueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { ApiError } from "@/lib/api";
import type { ConnectionState } from "@/lib/socket";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        // Don't hammer the server for errors a retry can't fix.
        retry: (count, err) =>
          !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      },
    },
  });
}

export type Theme = "light" | "dark";
export const THEME_KEY = "vehicle-access.theme";

export interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
}
export const ThemeContext = createContext<ThemeState>({
  theme: "light",
  setTheme: () => undefined,
});
export const useTheme = () => useContext(ThemeContext);

export const ConnectionContext = createContext<ConnectionState>("offline");
export const useConnection = () => useContext(ConnectionContext);
