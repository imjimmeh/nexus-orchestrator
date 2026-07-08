export const jobOutputStatePath = (jobId: string): string =>
  `jobs.${jobId}.output`;

export async function hasPersistedJobOutput(
  getVariable: (path: string) => Promise<unknown>,
  jobId: string,
): Promise<boolean> {
  const value = await getVariable(jobOutputStatePath(jobId));
  if (value === null || value === undefined || typeof value !== 'object') {
    return false;
  }
  return Object.keys(value).length > 0;
}
