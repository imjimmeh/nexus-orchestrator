import type { ApiResponse, PaginatedResponse } from "./common.types";
import type {
  AdHocSessionListItem,
  CreateAdHocSessionResponse,
} from "./ad-hoc-sessions.types";
import type {
  ChatSessionDetail,
  ChatSessionListItem,
  ChatSessionParticipant,
  ChatSessionState,
  ChatTelemetryAuth,
  CreateChatSessionResponse,
  InviteChatSessionParticipantResponse,
} from "./chat-sessions.types";
import type { ApiClientWorkflowMethods } from "./client.workflow.types";

type WorkflowSessionApiMethods = Pick<
  ApiClientWorkflowMethods,
  | "createAdHocSession"
  | "getAdHocSessions"
  | "createChatSession"
  | "getChatSessions"
  | "getChatSession"
  | "getChatSessionParticipants"
  | "getChatSessionState"
  | "inviteChatSessionParticipant"
  | "getChatSessionChildren"
  | "cancelChatSession"
  | "retryChatSessionNow"
  | "getChatSessionTelemetryAuth"
  | "getChatSessionEvents"
  | "sendChatSessionMessage"
  | "submitChatSessionQuestionAnswers"
>;

const workflowSessionApiMethods: WorkflowSessionApiMethods = {
  async createAdHocSession(request) {
    const response = await this.client.post<
      ApiResponse<CreateAdHocSessionResponse>
    >("/sessions/ad-hoc", request);
    return response.data.data;
  },

  async getAdHocSessions(params) {
    const response = await this.client.get<ApiResponse<AdHocSessionListItem[]>>(
      "/sessions/ad-hoc",
      {
        params: params ?? {},
      },
    );
    return response.data.data;
  },

  async createChatSession(request) {
    const response = await this.client.post<
      ApiResponse<CreateChatSessionResponse>
    >("/sessions/chat", request);
    return response.data.data;
  },

  async getChatSessions(params) {
    const query: Record<string, string> = {};
    if (params?.projectId) query.projectId = params.projectId;
    if (params?.status) query.status = params.status;
    if (params?.search) query.search = params.search;
    if (params?.limit !== undefined) query.limit = String(params.limit);
    if (params?.offset !== undefined) query.offset = String(params.offset);

    const response = await this.client.get<
      PaginatedResponse<ChatSessionListItem>
    >("/sessions/chat", {
      params: Object.keys(query).length > 0 ? query : undefined,
    });
    return response.data;
  },

  async getChatSession(id) {
    const response = await this.client.get<ApiResponse<ChatSessionDetail>>(
      `/sessions/chat/${id}`,
    );
    return response.data.data;
  },

  async getChatSessionParticipants(id) {
    const response = await this.client.get<
      ApiResponse<ChatSessionParticipant[]>
    >(`/sessions/chat/${id}/participants`);
    return response.data.data;
  },

  async getChatSessionState(id) {
    const response = await this.client.get<ApiResponse<ChatSessionState>>(
      `/sessions/chat/${id}/state`,
    );
    return response.data.data;
  },

  async inviteChatSessionParticipant(id, request) {
    const response = await this.client.post<
      ApiResponse<InviteChatSessionParticipantResponse>
    >(`/sessions/chat/${id}/participants/invite`, request);
    return response.data.data;
  },

  async getChatSessionChildren(id) {
    const response = await this.client.get<ApiResponse<ChatSessionListItem[]>>(
      `/sessions/chat/${id}/children`,
    );
    return response.data.data;
  },

  async cancelChatSession(id) {
    await this.client.delete(`/sessions/chat/${id}`);
  },

  async retryChatSessionNow(id) {
    return this.post<ChatSessionListItem>(`/sessions/chat/${id}/retry`, {});
  },

  async getChatSessionTelemetryAuth(id) {
    const response = await this.client.get<ApiResponse<ChatTelemetryAuth>>(
      `/sessions/chat/${id}/telemetry-auth`,
    );
    return response.data.data;
  },

  async getChatSessionEvents(id) {
    const response = await this.client.get<
      ApiResponse<Record<string, unknown>[]>
    >(`/sessions/chat/${id}/events`);
    return response.data.data;
  },

  async sendChatSessionMessage(id, message, attachmentIds) {
    const body: { message: string; attachmentIds?: string[] } = { message };
    if (attachmentIds && attachmentIds.length > 0) {
      body.attachmentIds = attachmentIds;
    }
    const response = await this.client.post<
      ApiResponse<{ acknowledged: true }>
    >(`/sessions/chat/${id}/messages`, body);
    return response.data.data;
  },

  async submitChatSessionQuestionAnswers(id, answers) {
    const response = await this.client.post<
      ApiResponse<{ acknowledged: true }>
    >(`/sessions/chat/${id}/question-answers`, { answers });
    return response.data.data;
  },
};

export { workflowSessionApiMethods };
