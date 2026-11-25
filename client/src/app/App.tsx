// The router. Each area (guard, resident, admin) is lazy-loaded, so a resident's phone never
// downloads the admin dashboard and its charts. Role checks live in the layouts.
import { lazy, Suspense } from "react";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router";
import { ListSkeleton } from "@/components/ui/card";
import { AdminLayout, GuardLayout, ResidentLayout } from "./layouts";
import { ErrorPage, NotFoundPage } from "./pages";

const LandingPage = lazy(() => import("@/features/landing/LandingPage"));
const LoginPage = lazy(() => import("@/features/auth/LoginPage"));
const GuardConsole = lazy(() => import("@/features/guard/GuardConsole"));
const ResidentApprovals = lazy(() => import("@/features/resident/Approvals"));
const ResidentPasses = lazy(() => import("@/features/resident/GuestPasses"));
const ResidentHistory = lazy(() => import("@/features/resident/History"));
const ResidentProfile = lazy(() => import("@/features/resident/Profile"));
const AdminOverview = lazy(() => import("@/features/admin/Overview"));
const AdminVisits = lazy(() => import("@/features/admin/Visits"));
const AdminGateEvents = lazy(() => import("@/features/admin/GateEvents"));
const AdminResources = lazy(() => import("@/features/admin/Resources"));
const AdminChecks = lazy(() => import("@/features/admin/Checks"));
const AdminNotifications = lazy(() => import("@/features/admin/Notifications"));
const AdminAudit = lazy(() => import("@/features/admin/AuditLog"));
const AdminSettings = lazy(() => import("@/features/admin/Settings"));

const routes = [
  {
    element: (
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <Outlet />
      </Suspense>
    ),
    errorElement: <ErrorPage />,
    children: [
      { path: "/", element: <LandingPage /> },
      { path: "/login", element: <LoginPage /> },
      {
        path: "/guard",
        element: <GuardLayout />,
        children: [{ index: true, element: <GuardConsole /> }],
      },
      {
        path: "/resident",
        element: <ResidentLayout />,
        children: [
          { index: true, element: <ResidentApprovals /> },
          { path: "passes", element: <ResidentPasses /> },
          { path: "history", element: <ResidentHistory /> },
          { path: "profile", element: <ResidentProfile /> },
        ],
      },
      {
        path: "/admin",
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminOverview /> },
          { path: "visits", element: <AdminVisits /> },
          { path: "gate-events", element: <AdminGateEvents /> },
          { path: "flats", element: <AdminResources kind="flats" /> },
          { path: "residents", element: <AdminResources kind="residents" /> },
          { path: "vehicles", element: <AdminResources kind="vehicles" /> },
          { path: "guards", element: <AdminResources kind="guards" /> },
          { path: "gates", element: <AdminResources kind="gates" /> },
          { path: "watchlist", element: <AdminResources kind="watchlist" /> },
          { path: "checks", element: <AdminChecks /> },
          { path: "notifications", element: <AdminNotifications /> },
          { path: "audit", element: <AdminAudit /> },
          { path: "settings", element: <AdminSettings /> },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

const router = createBrowserRouter(routes);

export function App() {
  return <RouterProvider router={router} />;
}
