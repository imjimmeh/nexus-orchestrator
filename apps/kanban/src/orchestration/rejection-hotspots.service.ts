import { Injectable } from "@nestjs/common";
import { WorkItemService } from "../work-item/work-item.service";
import {
  aggregateRejectionHotspots,
  normalizeArea,
  type RejectionFeedbackLike,
  type RejectionHotspot,
} from "./rejection-hotspots.helper";

const DEFAULT_AREA_DEPTH = 3;

@Injectable()
export class RejectionHotspotsService {
  constructor(private readonly workItems: WorkItemService) {}

  async getHotspots(
    projectId: string,
    options?: { depth?: number },
  ): Promise<RejectionHotspot[]> {
    const depth = options?.depth ?? DEFAULT_AREA_DEPTH;
    const items = await this.workItems.listWorkItems(projectId);
    const feedbacks: RejectionFeedbackLike[] = [];
    for (const item of items) {
      const config = item.executionConfig as Record<string, unknown> | null;
      const feedback = config?.["rejectionFeedback"];
      if (feedback && typeof feedback === "object") {
        feedbacks.push(feedback);
      }
    }
    return aggregateRejectionHotspots(feedbacks, depth);
  }

  /** Total rejection count across the areas the given files belong to. */
  async areaRejectionScore(
    projectId: string,
    files: string[],
    options?: { depth?: number },
  ): Promise<number> {
    const depth = options?.depth ?? DEFAULT_AREA_DEPTH;
    const hotspots = await this.getHotspots(projectId, { depth });
    const areas = new Set(files.map((file) => normalizeArea(file, depth)));
    return hotspots
      .filter((hotspot) => areas.has(hotspot.area))
      .reduce((sum, hotspot) => sum + hotspot.count, 0);
  }
}
