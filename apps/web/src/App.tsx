import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { ReactFlowProvider } from "@xyflow/react";
import { useAuthStore } from "./stores/auth.store";
import { Layout } from "./components/layout";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { ErrorBoundary } from "./components/error-boundary/ErrorBoundary";
import { Dashboard } from "./pages/Dashboard";
import { Workflows } from "./pages/workflows/Workflows";
import { WorkflowDetail } from "./pages/workflows/WorkflowDetail";
import { WorkflowEditorPage } from "./components/workflow-editor/WorkflowEditorPage";
import { WorkflowRunDetail } from "./pages/workflows/WorkflowRunDetail";
import { AgentProfiles } from "./pages/agents/AgentProfiles";
import { AgentProfileEditor } from "./pages/agents/AgentProfileEditor";
import { AgentSkills } from "./pages/agents/AgentSkills";
import { ImprovementsQueue } from "./pages/improvements/ImprovementsQueue";

import { Providers } from "./pages/providers/Providers";
import { ProviderOAuthCallback } from "./pages/providers/ProviderOAuthCallback";
import { Tools } from "./pages/tools/Tools";
import { Secrets } from "./pages/secrets/Secrets";
import { Settings } from "./pages/Settings";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { AcceptInvite } from "./pages/AcceptInvite";
import { Users } from "./pages/Users";
import { MemoryExplorer } from "./pages/memory/MemoryExplorer";
import { Setup } from "@/pages/setup/Setup";
import { ActiveSessionWorkspace } from "./pages/active-session/ActiveSessionWorkspace";
import { Projects } from "./pages/projects/Projects";
import { ProjectCreate } from "./pages/projects/ProjectCreate";
import { ProjectWorkspace } from "./pages/project-workspace/ProjectWorkspace";
import { GlobalWorkItemsPage } from "./pages/work-items/GlobalWorkItemsPage";
import { SessionInboxPage } from "./pages/sessions/SessionInboxPage";
import { SchedulesPage } from "./pages/schedules/SchedulesPage";
import { Events } from "./pages/events/Events";
import { Notifications } from "./pages/Notifications";
import { Unauthorized } from "./pages/Unauthorized";
import { NotFound } from "./pages/NotFound";
import { Doctor } from "./pages/operations/Doctor";
import { BudgetPage } from "./pages/admin/BudgetPage";
import { ScopedConfigViewer } from "./pages/admin/ScopedConfigViewer";
import { GitOpsStatus } from "./pages/gitops/GitOpsStatus";
import { ScopeDetailPage } from "./pages/scopes/ScopeDetailPage";
import { OrgHierarchyPage } from "./pages/scopes/OrgHierarchyPage";
import { AuditLogPage } from "./pages/audit/AuditLogPage";
import { HarnessesAdminPage } from "./pages/harnesses/HarnessesAdminPage";
import { VariablesEditorPage } from "./pages/variables/VariablesEditorPage";

function App() {
  useEffect(() => {
    // Validate stored auth when app initializes
    const hasHydrated = useAuthStore.persist?.hasHydrated?.();
    const { isAuthenticated } = useAuthStore.getState();
    if (hasHydrated && isAuthenticated) {
      const { validateAuth } = useAuthStore.getState();
      void validateAuth();
    }
  }, []);
  return (
    <Routes>
      {/* Public routes - no layout */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route path="/unauthorized" element={<Unauthorized />} />

      {/* Protected routes with layout */}
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <ErrorBoundary>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/workflows" element={<Workflows />} />
                  <Route
                    path="/workflows/new"
                    element={
                      <ReactFlowProvider>
                        <WorkflowEditorPage isEditMode={false} />
                      </ReactFlowProvider>
                    }
                  />
                  <Route path="/workflows/:id" element={<WorkflowDetail />} />
                  <Route
                    path="/workflows/:id/runs/:runId"
                    element={<WorkflowRunDetail />}
                  />
                  <Route
                    path="/workflows/:id/edit"
                    element={
                      <ReactFlowProvider>
                        <WorkflowEditorPage isEditMode={true} />
                      </ReactFlowProvider>
                    }
                  />
                  <Route path="/agents" element={<AgentProfiles />} />
                  <Route path="/agents/new" element={<AgentProfileEditor />} />
                  <Route
                    path="/agents/:id/edit"
                    element={<AgentProfileEditor />}
                  />
                  <Route path="/agent-skills" element={<AgentSkills />} />
                  <Route path="/improvements" element={<ImprovementsQueue />} />
                  <Route
                    path="/models"
                    element={<Navigate to="/providers" replace />}
                  />
                  <Route path="/providers" element={<Providers />} />
                  <Route
                    path="/providers/oauth/callback"
                    element={<ProviderOAuthCallback />}
                  />
                  <Route path="/tools" element={<Tools />} />
                  <Route path="/secrets" element={<Secrets />} />
                  <Route path="/projects" element={<Projects />} />
                  <Route path="/projects/new" element={<ProjectCreate />} />
                  <Route
                    path="/projects/:projectId"
                    element={<ProjectWorkspace />}
                  />
                  <Route
                    path="/projects/:projectId/board"
                    element={<ProjectWorkspace />}
                  />
                  <Route
                    path="/projects/:projectId/workflow-files/new"
                    element={
                      <ReactFlowProvider>
                        <WorkflowEditorPage isEditMode={true} repoMode={true} />
                      </ReactFlowProvider>
                    }
                  />
                  <Route
                    path="/projects/:projectId/workflow-files/:filename/edit"
                    element={
                      <ReactFlowProvider>
                        <WorkflowEditorPage isEditMode={true} repoMode={true} />
                      </ReactFlowProvider>
                    }
                  />
                  <Route
                    path="/projects/:projectId/work-items/:workItemId/active-session"
                    element={<ActiveSessionWorkspace />}
                  />
                  <Route
                    path="/projects/:projectId/runs/:runId/active-session"
                    element={<ActiveSessionWorkspace />}
                  />
                  <Route path="/work-items" element={<GlobalWorkItemsPage />} />
                  <Route path="/schedules" element={<SchedulesPage />} />
                  <Route path="/sessions" element={<SessionInboxPage />} />
                  <Route
                    path="/sessions/:sessionId"
                    element={<SessionInboxPage />}
                  />
                  <Route
                    path="/chat-sessions/:sessionId"
                    element={<SessionInboxPage />}
                  />
                  <Route path="/notifications" element={<Notifications />} />
                  <Route path="/events" element={<Events />} />
                  <Route path="/operations/doctor" element={<Doctor />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/memory" element={<MemoryExplorer />} />
                  <Route
                    path="/setup"
                    element={
                      <ProtectedRoute requiredRoles={["admin"]}>
                        <Setup />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/users"
                    element={
                      <ProtectedRoute requiredRoles={["admin"]}>
                        <Users />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/budget-policies"
                    element={
                      <ProtectedRoute requiredRoles={["admin"]}>
                        <BudgetPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/scoped-config"
                    element={
                      <ProtectedRoute requiredRoles={["admin"]}>
                        <ScopedConfigViewer />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/harnesses"
                    element={
                      <ProtectedRoute requiredRoles={["admin"]}>
                        <HarnessesAdminPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/gitops"
                    element={
                      <ProtectedRoute requiredRoles={["admin"]}>
                        <GitOpsStatus />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/scopes/:id" element={<ScopeDetailPage />} />
                  <Route
                    path="/scopes/:id/manage"
                    element={<OrgHierarchyPage />}
                  />
                  <Route path="/audit" element={<AuditLogPage />} />
                  <Route path="/variables" element={<VariablesEditorPage />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </ErrorBoundary>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export default App;
