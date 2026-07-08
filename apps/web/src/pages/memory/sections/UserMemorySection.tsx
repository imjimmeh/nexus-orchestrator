import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { useUserMemorySegments } from "@/hooks/useMemoryExplorer";
import type { MemoryTypeFilter } from "../MemoryExplorer.types";
import { MemoryFilterBar, MemorySegmentTable } from "./MemorySection.shared";

interface UserMemorySectionProps {
  isAdminUser: boolean;
  currentUserId: string;
  currentUsername: string;
  selectedUserId: string;
  userMemoryType: MemoryTypeFilter;
  userSearchDraft: string;
  userOffset: number;
  userOptions: Array<{ id: string; username: string; email: string }>;
  selectedUserName?: string;
  userMemoryQuery: ReturnType<typeof useUserMemorySegments>;
  userEmptyStateMessage: string;
  onSelectedUserIdChange: (value: string) => void;
  onUserMemoryTypeChange: (value: MemoryTypeFilter) => void;
  onUserSearchDraftChange: (value: string) => void;
  onUserSearchSubmit: () => void;
  onUserOffsetChange: (offset: number) => void;
  isUsersLoading: boolean;
}

function renderUserMemoryStatus(props: {
  isAdminUser: boolean;
  currentUserId: string;
  currentUsername: string;
  selectedUserName?: string;
  activeUserId: string;
  usersLoading: boolean;
  userCount: number;
  isUserMemoryLoading: boolean;
  isUserMemoryError: boolean;
}) {
  const {
    isAdminUser,
    currentUserId,
    currentUsername,
    selectedUserName,
    activeUserId,
    usersLoading,
    userCount,
    isUserMemoryLoading,
    isUserMemoryError,
  } = props;

  if (isAdminUser && usersLoading) {
    return <p className="text-sm text-muted-foreground">Loading users...</p>;
  }

  if (isAdminUser && !usersLoading && userCount === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No users are available to inspect yet.
      </p>
    );
  }

  if (isAdminUser && selectedUserName) {
    return (
      <p className="text-sm text-muted-foreground">
        Viewing memory for{" "}
        <span className="font-medium text-foreground">{selectedUserName}</span>.
      </p>
    );
  }

  if (!isAdminUser && currentUserId.length > 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Viewing memory for{" "}
        <span className="font-medium text-foreground">{currentUsername}</span>.
      </p>
    );
  }

  if (activeUserId.trim().length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {isAdminUser
          ? "Select a user to load their memory segments."
          : "Your user profile is still loading."}
      </p>
    );
  }

  if (isUserMemoryLoading) {
    return <p className="text-sm text-muted-foreground">Loading memory...</p>;
  }

  if (isUserMemoryError) {
    return (
      <p className="text-sm text-destructive">
        Unable to load user memory segments.
      </p>
    );
  }

  return null;
}

export function UserMemorySection({
  isAdminUser,
  currentUserId,
  currentUsername,
  selectedUserId,
  userMemoryType,
  userSearchDraft,
  userOffset,
  userOptions,
  selectedUserName,
  userMemoryQuery,
  userEmptyStateMessage,
  onSelectedUserIdChange,
  onUserMemoryTypeChange,
  onUserSearchDraftChange,
  onUserSearchSubmit,
  onUserOffsetChange,
  isUsersLoading,
}: Readonly<UserMemorySectionProps>) {
  const activeUserId = isAdminUser ? selectedUserId : currentUserId;
  const status = renderUserMemoryStatus({
    isAdminUser,
    currentUserId,
    currentUsername,
    selectedUserName,
    activeUserId,
    usersLoading: isUsersLoading,
    userCount: userOptions.length,
    isUserMemoryLoading: userMemoryQuery.isLoading,
    isUserMemoryError: userMemoryQuery.isError,
  });

  const showTable =
    activeUserId.trim().length > 0 &&
    !userMemoryQuery.isLoading &&
    !userMemoryQuery.isError;

  return (
    <>
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{isAdminUser ? "User Memory" : "My Memory"}</CardTitle>
            <Badge variant="outline">
              Total {(userMemoryQuery.data?.total ?? 0).toString()}
            </Badge>
          </div>

          <MemoryFilterBar
            searchDraft={userSearchDraft}
            onSearchDraftChange={onUserSearchDraftChange}
            memoryType={userMemoryType}
            onMemoryTypeChange={onUserMemoryTypeChange}
            onSearchSubmit={onUserSearchSubmit}
            isLoading={userMemoryQuery.isLoading}
            extraControl={
              isAdminUser ? (
                <Select
                  value={selectedUserId || "__placeholder__"}
                  onValueChange={(value) => {
                    const nextValue = value === "__placeholder__" ? "" : value;
                    onSelectedUserIdChange(nextValue);
                  }}
                >
                  <SelectTrigger aria-label="User selector">
                    <SelectValue placeholder="Select user" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__placeholder__">Select user</SelectItem>
                    {userOptions.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.username} ({user.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : undefined
            }
          />
        </CardHeader>

        <CardContent className="space-y-3">
          {status}

          {showTable ? (
            <MemorySegmentTable
              items={userMemoryQuery.data?.items ?? []}
              total={userMemoryQuery.data?.total ?? 0}
              offset={userOffset}
              onOffsetChange={onUserOffsetChange}
              emptyStateMessage={userEmptyStateMessage}
            />
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
