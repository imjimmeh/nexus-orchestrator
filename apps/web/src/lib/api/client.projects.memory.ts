import type { ApiClient } from "./client";
import type { ApiClientProjectMethods } from "./client.projects.types";
import type { ProjectMemorySegmentListResponse } from "./chat-sessions.types";

type ProjectMemoryApiMethods = Pick<
  ApiClientProjectMethods,
  "getProjectMemorySegments"
>;

export const projectMemoryApiMethods: ProjectMemoryApiMethods = {
  async getProjectMemorySegments(this: ApiClient, projectId, params) {
    const query = new URLSearchParams();

    if (params?.memory_type) {
      query.append("memory_type", params.memory_type);
    }
    if (params?.query) {
      query.append("query", params.query);
    }
    if (params?.limit !== undefined) {
      query.append("limit", String(params.limit));
    }
    if (params?.offset !== undefined) {
      query.append("offset", String(params.offset));
    }

    const suffix = query.toString().length > 0 ? `?${query.toString()}` : "";

    return this.get<ProjectMemorySegmentListResponse>(
      `/projects/${projectId}/memory/segments${suffix}`,
    );
  },
};
