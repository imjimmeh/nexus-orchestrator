import { Navigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/stores/auth.store";
import { api } from "@/lib/api/client";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRoles?: string[];
}

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}

function isAdminUser(user: { roles: string[] } | null | undefined): boolean {
  return user?.roles.includes("admin") ?? false;
}

function hasRequiredRole(
  userRoles: string[] | undefined,
  requiredRoles: string[] | undefined,
): boolean {
  if (!requiredRoles || requiredRoles.length === 0) {
    return true;
  }

  return requiredRoles.some((role) =>
    (userRoles ?? []).includes(role as "admin" | "user"),
  );
}

function getSetupRedirectPath(params: {
  isAdmin: boolean;
  hasCheckedSetup: boolean;
  requiresSetup: boolean;
  pathname: string;
}): string | null {
  const { isAdmin, hasCheckedSetup, requiresSetup, pathname } = params;

  if (!isAdmin || !hasCheckedSetup) {
    return null;
  }

  if (requiresSetup && pathname !== "/setup") {
    return "/setup";
  }

  if (!requiresSetup && pathname === "/setup") {
    return "/";
  }

  return null;
}

export function ProtectedRoute({
  children,
  requiredRoles,
}: Readonly<ProtectedRouteProps>) {
  const { isAuthenticated, hasHydrated } = useAuth();
  const location = useLocation();
  const [hasCheckedSetup, setHasCheckedSetup] = useState(false);
  const [requiresSetup, setRequiresSetup] = useState(false);

  useEffect(() => {
    let active = true;

    // Reset state so we re-check on navigation
    setHasCheckedSetup(false);

    if (!hasHydrated || !isAuthenticated) {
      return;
    }

    const user = useAuthStore.getState().user;
    const isAdmin = isAdminUser(user);

    if (!isAdmin) {
      setHasCheckedSetup(true);
      setRequiresSetup(false);
      return;
    }

    async function checkSetup() {
      try {
        const status = await api.getSetupStatus();
        if (active) {
          setRequiresSetup(status.requiresSetup);
        }
      } catch {
        if (active) {
          setRequiresSetup(false);
        }
      } finally {
        if (active) {
          setHasCheckedSetup(true);
        }
      }
    }

    void checkSetup();

    return () => {
      active = false;
    };
  }, [isAuthenticated, hasHydrated, location.pathname]);

  if (!hasHydrated) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const user = useAuthStore.getState().user;
  const isAdmin = isAdminUser(user);

  if (!hasRequiredRole(user?.roles, requiredRoles)) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (isAdmin && !hasCheckedSetup) {
    return <LoadingScreen />;
  }

  const setupRedirect = getSetupRedirectPath({
    isAdmin,
    hasCheckedSetup,
    requiresSetup,
    pathname: location.pathname,
  });
  if (setupRedirect) {
    return <Navigate to={setupRedirect} replace />;
  }

  return <>{children}</>;
}
