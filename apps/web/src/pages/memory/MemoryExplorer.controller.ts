import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import {
  useChatMemoryObservability,
  useChatMemorySegments,
  useSystemMemorySegments,
  useUserMemorySegments,
} from "@/hooks/useMemoryExplorer";
import type { ChatMemorySource } from "@/lib/api/memory.types";
import { queryKeys } from "@/lib/queryKeys";
import { usersApi } from "@/lib/api/users";
import {
  getChatEmptyStateMessage,
  getSystemEmptyStateMessage,
  getUserEmptyStateMessage,
} from "./MemoryExplorer.empty-states";
import {
  buildChatMemoryRequest,
  buildMemoryRequest,
  MEMORY_EXPLORER_PAGE_SIZE,
} from "./MemoryExplorer.requests";
import type { ExplorerScope, MemoryTypeFilter } from "./MemoryExplorer.types";

interface UserMemoryState {
  selectedUserId: string;
  userMemoryType: MemoryTypeFilter;
  userSearchDraft: string;
  userOffset: number;
  userQuery: ReturnType<typeof useUserMemorySegments>;
  userEmptyStateMessage: string;
  setSelectedUserIdFromAuth: (value: string) => void;
  setSelectedUserId: (value: string) => void;
  setUserMemoryType: (value: MemoryTypeFilter) => void;
  setUserSearchDraft: (value: string) => void;
  submitUserSearch: () => void;
  setUserOffset: (value: number) => void;
}

interface SystemMemoryState {
  systemMemoryType: MemoryTypeFilter;
  systemSearchDraft: string;
  systemEntityIdDraft: string;
  systemOffset: number;
  systemQuery: ReturnType<typeof useSystemMemorySegments>;
  systemEmptyStateMessage: string;
  setSystemMemoryType: (value: MemoryTypeFilter) => void;
  setSystemSearchDraft: (value: string) => void;
  setSystemEntityIdDraft: (value: string) => void;
  submitSystemSearch: () => void;
  setSystemOffset: (value: number) => void;
}

interface ChatMemoryState {
  chatSource: ChatMemorySource;
  chatMemoryType: MemoryTypeFilter;
  chatSearchDraft: string;
  chatProfileIdDraft: string;
  chatSessionIdDraft: string;
  chatIncludeArchived: boolean;
  chatOnlyUndistilled: boolean;
  chatOffset: number;
  chatMemoryQuery: ReturnType<typeof useChatMemorySegments>;
  chatObservabilityQuery: ReturnType<typeof useChatMemoryObservability>;
  chatEmptyStateMessage: string;
  setChatSource: (value: ChatMemorySource) => void;
  setChatMemoryType: (value: MemoryTypeFilter) => void;
  setChatSearchDraft: (value: string) => void;
  setChatProfileIdDraft: (value: string) => void;
  setChatSessionIdDraft: (value: string) => void;
  setChatIncludeArchived: (value: boolean) => void;
  setChatOnlyUndistilled: (value: boolean) => void;
  submitChatSearch: () => void;
  setChatOffset: (value: number) => void;
}

interface MemoryExplorerControllerValue {
  isAdminUser: boolean;
  currentUserId: string;
  currentUsername: string;
  scope: ExplorerScope;
  setScope: (value: ExplorerScope) => void;
  usersQuery: ReturnType<typeof useQuery>;
  userOptions: Array<{ id: string; username: string; email: string }>;
  selectedUserName?: string;
  user: UserMemoryState;
  system: SystemMemoryState;
  chat: ChatMemoryState;
}

function useUserMemoryState(): UserMemoryState {
  const [selectedUserId, setSelectedUserIdState] = useState("");
  const [userMemoryType, setUserMemoryTypeState] =
    useState<MemoryTypeFilter>("all");
  const [userSearchDraft, setUserSearchDraft] = useState("");
  const [userQueryText, setUserQueryText] = useState("");
  const [userOffset, setUserOffsetState] = useState(0);

  const userQuery = useUserMemorySegments(
    selectedUserId,
    buildMemoryRequest({
      memoryType: userMemoryType,
      queryText: userQueryText,
      limit: MEMORY_EXPLORER_PAGE_SIZE,
      offset: userOffset,
    }),
  );

  const userEmptyStateMessage = useMemo(() => {
    return getUserEmptyStateMessage(userQueryText);
  }, [userQueryText]);

  const setSelectedUserIdFromAuth = useCallback((value: string) => {
    setSelectedUserIdState(value);
  }, []);

  const setSelectedUserId = useCallback((value: string) => {
    setSelectedUserIdState(value);
    setUserOffsetState(0);
  }, []);

  const setUserMemoryType = useCallback((value: MemoryTypeFilter) => {
    setUserMemoryTypeState(value);
    setUserOffsetState(0);
  }, []);

  const submitUserSearch = useCallback(() => {
    setUserQueryText(userSearchDraft.trim());
    setUserOffsetState(0);
  }, [userSearchDraft]);

  return {
    selectedUserId,
    userMemoryType,
    userSearchDraft,
    userOffset,
    userQuery,
    userEmptyStateMessage,
    setSelectedUserIdFromAuth,
    setSelectedUserId,
    setUserMemoryType,
    setUserSearchDraft,
    submitUserSearch,
    setUserOffset: setUserOffsetState,
  };
}

function useSystemMemoryState(): SystemMemoryState {
  const [systemMemoryType, setSystemMemoryTypeState] =
    useState<MemoryTypeFilter>("all");
  const [systemSearchDraft, setSystemSearchDraft] = useState("");
  const [systemQueryText, setSystemQueryText] = useState("");
  const [systemEntityIdDraft, setSystemEntityIdDraft] = useState("");
  const [systemEntityId, setSystemEntityId] = useState("");
  const [systemOffset, setSystemOffsetState] = useState(0);

  const systemQuery = useSystemMemorySegments(
    buildMemoryRequest({
      entityId: systemEntityId,
      memoryType: systemMemoryType,
      queryText: systemQueryText,
      limit: MEMORY_EXPLORER_PAGE_SIZE,
      offset: systemOffset,
    }),
  );

  const systemEmptyStateMessage = useMemo(() => {
    return getSystemEmptyStateMessage(systemQueryText, systemEntityId);
  }, [systemEntityId, systemQueryText]);

  const setSystemMemoryType = useCallback((value: MemoryTypeFilter) => {
    setSystemMemoryTypeState(value);
    setSystemOffsetState(0);
  }, []);

  const submitSystemSearch = useCallback(() => {
    setSystemQueryText(systemSearchDraft.trim());
    setSystemEntityId(systemEntityIdDraft.trim());
    setSystemOffsetState(0);
  }, [systemEntityIdDraft, systemSearchDraft]);

  return {
    systemMemoryType,
    systemSearchDraft,
    systemEntityIdDraft,
    systemOffset,
    systemQuery,
    systemEmptyStateMessage,
    setSystemMemoryType,
    setSystemSearchDraft,
    setSystemEntityIdDraft,
    submitSystemSearch,
    setSystemOffset: setSystemOffsetState,
  };
}

function useChatMemoryState(): ChatMemoryState {
  const [chatSource, setChatSourceState] =
    useState<ChatMemorySource>("profile");
  const [chatMemoryType, setChatMemoryTypeState] =
    useState<MemoryTypeFilter>("all");
  const [chatSearchDraft, setChatSearchDraft] = useState("");
  const [chatQueryText, setChatQueryText] = useState("");
  const [chatProfileIdDraft, setChatProfileIdDraft] = useState("");
  const [chatProfileId, setChatProfileId] = useState("");
  const [chatSessionIdDraft, setChatSessionIdDraft] = useState("");
  const [chatSessionId, setChatSessionId] = useState("");
  const [chatIncludeArchived, setChatIncludeArchivedState] = useState(false);
  const [chatOnlyUndistilled, setChatOnlyUndistilledState] = useState(false);
  const [chatOffset, setChatOffsetState] = useState(0);

  const chatMemoryQuery = useChatMemorySegments(
    buildChatMemoryRequest({
      source: chatSource,
      memoryType: chatMemoryType,
      queryText: chatQueryText,
      profileId: chatProfileId,
      chatSessionId,
      includeArchived: chatIncludeArchived,
      onlyUndistilled: chatOnlyUndistilled,
      limit: MEMORY_EXPLORER_PAGE_SIZE,
      offset: chatOffset,
    }),
  );

  const chatObservabilityQuery = useChatMemoryObservability();

  const chatEmptyStateMessage = useMemo(() => {
    return getChatEmptyStateMessage({
      queryText: chatQueryText,
      source: chatSource,
      onlyUndistilled: chatOnlyUndistilled,
    });
  }, [chatOnlyUndistilled, chatQueryText, chatSource]);

  const setChatSource = useCallback((value: ChatMemorySource) => {
    setChatSourceState(value);
    setChatOffsetState(0);
  }, []);

  const setChatMemoryType = useCallback((value: MemoryTypeFilter) => {
    setChatMemoryTypeState(value);
    setChatOffsetState(0);
  }, []);

  const setChatIncludeArchived = useCallback((value: boolean) => {
    setChatIncludeArchivedState(value);
    setChatOffsetState(0);
  }, []);

  const setChatOnlyUndistilled = useCallback((value: boolean) => {
    setChatOnlyUndistilledState(value);
    setChatOffsetState(0);
  }, []);

  const submitChatSearch = useCallback(() => {
    setChatQueryText(chatSearchDraft.trim());
    setChatProfileId(chatProfileIdDraft.trim());
    setChatSessionId(chatSessionIdDraft.trim());
    setChatOffsetState(0);
  }, [chatProfileIdDraft, chatSearchDraft, chatSessionIdDraft]);

  return {
    chatSource,
    chatMemoryType,
    chatSearchDraft,
    chatProfileIdDraft,
    chatSessionIdDraft,
    chatIncludeArchived,
    chatOnlyUndistilled,
    chatOffset,
    chatMemoryQuery,
    chatObservabilityQuery,
    chatEmptyStateMessage,
    setChatSource,
    setChatMemoryType,
    setChatSearchDraft,
    setChatProfileIdDraft,
    setChatSessionIdDraft,
    setChatIncludeArchived,
    setChatOnlyUndistilled,
    submitChatSearch,
    setChatOffset: setChatOffsetState,
  };
}

export function useMemoryExplorerController(
  initialScope: ExplorerScope,
): MemoryExplorerControllerValue {
  const { isAdmin, user } = useAuth();
  const isAdminUser = isAdmin();
  const currentUserId = user?.id ?? "";
  const currentUsername = user?.username ?? "you";
  const [scope, setScope] = useState<ExplorerScope>(
    isAdminUser ? initialScope : "users",
  );

  const userMemory = useUserMemoryState();
  const systemMemory = useSystemMemoryState();
  const chatMemory = useChatMemoryState();

  useEffect(() => {
    if (!isAdminUser && currentUserId.length > 0) {
      userMemory.setSelectedUserIdFromAuth(currentUserId);
      setScope("users");
    }
  }, [currentUserId, isAdminUser, userMemory.setSelectedUserIdFromAuth]);

  const usersQuery = useQuery({
    queryKey: queryKeys.memory.explorerUsers(),
    queryFn: () => usersApi.getUsers({ page: 1, limit: 100 }),
    enabled: isAdminUser,
  });

  const userOptions = usersQuery.data?.data ?? [];
  const selectedUser = userOptions.find(
    (candidate) => candidate.id === userMemory.selectedUserId,
  );

  return {
    isAdminUser,
    currentUserId,
    currentUsername,
    scope,
    setScope,
    usersQuery,
    userOptions,
    selectedUserName: selectedUser?.username,
    user: userMemory,
    system: systemMemory,
    chat: chatMemory,
  };
}
