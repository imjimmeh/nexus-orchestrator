import { Link } from "react-router-dom";
import { Database, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMemoryExplorerController } from "./MemoryExplorer.controller";
import type { ExplorerScope } from "./MemoryExplorer.types";
import { ChatMemorySection } from "./sections/ChatMemorySection";
import { SystemMemorySection } from "./sections/SystemMemorySection";
import { UserMemorySection } from "./sections/UserMemorySection";

interface MemoryExplorerProps {
  initialScope?: ExplorerScope;
}

interface MemoryExplorerHeaderProps {
  isAdminUser: boolean;
}

function MemoryExplorerHeader({
  isAdminUser,
}: Readonly<MemoryExplorerHeaderProps>) {
  const description = isAdminUser
    ? "Inspect user-scoped and system-scoped long-term memory without leaving the frontend."
    : "Inspect the long-term memory segments associated with your account.";

  const backLink = isAdminUser ? "/users" : "/";
  const backLabel = isAdminUser ? "Back to Users" : "Back to Dashboard";

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Memory Explorer</h2>
        <p className="text-muted-foreground">{description}</p>
      </div>
      <Button variant="outline" asChild>
        <Link to={backLink}>{backLabel}</Link>
      </Button>
    </div>
  );
}

// Not wired to the active app scope (Phase 5 Task 8): this page's `scope`
// prop/state (ExplorerScope = "users" | "system" | "chat") selects which
// memory-segment table is being browsed, not a scope_node in the
// multi-tenant hierarchy - memory segments carry no scope_node_id column.
export function MemoryExplorer({
  initialScope = "users",
}: Readonly<MemoryExplorerProps>) {
  const controller = useMemoryExplorerController(initialScope);

  return (
    <div className="space-y-6">
      <MemoryExplorerHeader isAdminUser={controller.isAdminUser} />

      <Tabs
        value={controller.scope}
        onValueChange={(value) => controller.setScope(value as ExplorerScope)}
        className="space-y-6"
      >
        {controller.isAdminUser ? (
          <TabsList>
            <TabsTrigger value="users" className="gap-2">
              <Users className="h-4 w-4" />
              User Memory
            </TabsTrigger>
            <TabsTrigger value="system" className="gap-2">
              <Database className="h-4 w-4" />
              System Memory
            </TabsTrigger>
            <TabsTrigger value="chat" className="gap-2">
              <Database className="h-4 w-4" />
              Chat Memory
            </TabsTrigger>
          </TabsList>
        ) : null}

        <TabsContent value="users" className="space-y-6">
          <UserMemorySection
            isAdminUser={controller.isAdminUser}
            currentUserId={controller.currentUserId}
            currentUsername={controller.currentUsername}
            selectedUserId={controller.user.selectedUserId}
            userMemoryType={controller.user.userMemoryType}
            userSearchDraft={controller.user.userSearchDraft}
            userOffset={controller.user.userOffset}
            userOptions={controller.userOptions}
            selectedUserName={controller.selectedUserName}
            userMemoryQuery={controller.user.userQuery}
            userEmptyStateMessage={controller.user.userEmptyStateMessage}
            onSelectedUserIdChange={controller.user.setSelectedUserId}
            onUserMemoryTypeChange={controller.user.setUserMemoryType}
            onUserSearchDraftChange={controller.user.setUserSearchDraft}
            onUserSearchSubmit={controller.user.submitUserSearch}
            onUserOffsetChange={controller.user.setUserOffset}
            isUsersLoading={controller.usersQuery.isLoading}
          />
        </TabsContent>

        {controller.isAdminUser ? (
          <TabsContent value="system" className="space-y-6">
            <SystemMemorySection
              systemMemoryType={controller.system.systemMemoryType}
              systemSearchDraft={controller.system.systemSearchDraft}
              systemEntityIdDraft={controller.system.systemEntityIdDraft}
              systemOffset={controller.system.systemOffset}
              systemMemoryQuery={controller.system.systemQuery}
              systemEmptyStateMessage={
                controller.system.systemEmptyStateMessage
              }
              onSystemMemoryTypeChange={controller.system.setSystemMemoryType}
              onSystemSearchDraftChange={controller.system.setSystemSearchDraft}
              onSystemEntityIdDraftChange={
                controller.system.setSystemEntityIdDraft
              }
              onSystemSearchSubmit={controller.system.submitSystemSearch}
              onSystemOffsetChange={controller.system.setSystemOffset}
            />
          </TabsContent>
        ) : null}

        {controller.isAdminUser ? (
          <TabsContent value="chat" className="space-y-6">
            <ChatMemorySection
              chatSource={controller.chat.chatSource}
              chatMemoryType={controller.chat.chatMemoryType}
              chatSearchDraft={controller.chat.chatSearchDraft}
              chatProfileIdDraft={controller.chat.chatProfileIdDraft}
              chatSessionIdDraft={controller.chat.chatSessionIdDraft}
              chatIncludeArchived={controller.chat.chatIncludeArchived}
              chatOnlyUndistilled={controller.chat.chatOnlyUndistilled}
              chatOffset={controller.chat.chatOffset}
              chatMemoryQuery={controller.chat.chatMemoryQuery}
              chatObservabilityQuery={controller.chat.chatObservabilityQuery}
              chatEmptyStateMessage={controller.chat.chatEmptyStateMessage}
              onChatSourceChange={controller.chat.setChatSource}
              onChatMemoryTypeChange={controller.chat.setChatMemoryType}
              onChatSearchDraftChange={controller.chat.setChatSearchDraft}
              onChatProfileIdDraftChange={controller.chat.setChatProfileIdDraft}
              onChatSessionIdDraftChange={controller.chat.setChatSessionIdDraft}
              onChatIncludeArchivedChange={
                controller.chat.setChatIncludeArchived
              }
              onChatOnlyUndistilledChange={
                controller.chat.setChatOnlyUndistilled
              }
              onChatSearchSubmit={controller.chat.submitChatSearch}
              onChatOffsetChange={controller.chat.setChatOffset}
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
