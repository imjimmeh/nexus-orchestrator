import type { ApiClient } from "./client";
import type { ApiClientProjectMethods } from "./client.projects.types";
import type {
  CloseProjectWarRoomSessionRequest,
  CloseProjectWarRoomSessionResponse,
  InviteProjectWarRoomParticipantRequest,
  InviteProjectWarRoomParticipantResponse,
  ListProjectWarRoomSessionsResponse,
  OpenProjectWarRoomSessionRequest,
  OpenProjectWarRoomSessionResponse,
  PostProjectWarRoomMessageRequest,
  PostProjectWarRoomMessageResponse,
  ProjectWarRoomStateResponse,
  SubmitProjectWarRoomSignoffRequest,
  SubmitProjectWarRoomSignoffResponse,
  UpdateProjectWarRoomBlackboardRequest,
  UpdateProjectWarRoomBlackboardResponse,
} from "./orchestration.types";

type ProjectWarRoomApiMethods = Pick<
  ApiClientProjectMethods,
  | "openProjectWarRoomSession"
  | "listProjectWarRoomSessions"
  | "getProjectWarRoomSessionState"
  | "inviteProjectWarRoomParticipant"
  | "postProjectWarRoomMessage"
  | "updateProjectWarRoomBlackboard"
  | "submitProjectWarRoomSignoff"
  | "closeProjectWarRoomSession"
>;

export const projectWarRoomApiMethods: ProjectWarRoomApiMethods = {
  async openProjectWarRoomSession(
    this: ApiClient,
    projectId,
    data: OpenProjectWarRoomSessionRequest,
  ) {
    return this.post<OpenProjectWarRoomSessionResponse>(
      `/projects/${projectId}/orchestration/war-room/sessions/open`,
      data,
    );
  },

  async listProjectWarRoomSessions(this: ApiClient, projectId, params) {
    const queryParams = new URLSearchParams();
    queryParams.append("workflow_run_id", params.workflow_run_id);
    if (params.active_only !== undefined) {
      queryParams.append("active_only", String(params.active_only));
    }

    return this.get<ListProjectWarRoomSessionsResponse>(
      `/projects/${projectId}/orchestration/war-room/sessions?${queryParams.toString()}`,
    );
  },

  async getProjectWarRoomSessionState(
    this: ApiClient,
    projectId,
    sessionId,
    params,
  ) {
    const queryParams = new URLSearchParams();
    queryParams.append("workflow_run_id", params.workflow_run_id);

    return this.get<ProjectWarRoomStateResponse>(
      `/projects/${projectId}/orchestration/war-room/sessions/${sessionId}?${queryParams.toString()}`,
    );
  },

  async inviteProjectWarRoomParticipant(
    this: ApiClient,
    projectId,
    sessionId,
    data: InviteProjectWarRoomParticipantRequest,
  ) {
    return this.post<InviteProjectWarRoomParticipantResponse>(
      `/projects/${projectId}/orchestration/war-room/sessions/${sessionId}/invite`,
      data,
    );
  },

  async postProjectWarRoomMessage(
    this: ApiClient,
    projectId,
    sessionId,
    data: PostProjectWarRoomMessageRequest,
  ) {
    return this.post<PostProjectWarRoomMessageResponse>(
      `/projects/${projectId}/orchestration/war-room/sessions/${sessionId}/messages`,
      data,
    );
  },

  async updateProjectWarRoomBlackboard(
    this: ApiClient,
    projectId,
    sessionId,
    data: UpdateProjectWarRoomBlackboardRequest,
  ) {
    return this.post<UpdateProjectWarRoomBlackboardResponse>(
      `/projects/${projectId}/orchestration/war-room/sessions/${sessionId}/blackboard`,
      data,
    );
  },

  async submitProjectWarRoomSignoff(
    this: ApiClient,
    projectId,
    sessionId,
    data: SubmitProjectWarRoomSignoffRequest,
  ) {
    return this.post<SubmitProjectWarRoomSignoffResponse>(
      `/projects/${projectId}/orchestration/war-room/sessions/${sessionId}/signoffs`,
      data,
    );
  },

  async closeProjectWarRoomSession(
    this: ApiClient,
    projectId,
    sessionId,
    data: CloseProjectWarRoomSessionRequest,
  ) {
    return this.post<CloseProjectWarRoomSessionResponse>(
      `/projects/${projectId}/orchestration/war-room/sessions/${sessionId}/close`,
      data,
    );
  },
};
