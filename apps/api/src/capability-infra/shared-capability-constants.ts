export const DEFAULT_TS_SNIPPET = `
export const tool = {
  execute: async (params: Record<string, unknown>) => {
    return { ok: true, ...params };
  }
};
`;
