export enum ToolSortField {
  NAME = "name",
  TIER = "tier_restriction",
}

export enum SortDirection {
  ASC = "asc",
  DESC = "desc",
}

export type ToolsQueryParams = {
  limit?: number;
  offset?: number;
  search?: string;
  sortBy?: ToolSortField;
  sortDir?: SortDirection;
};
