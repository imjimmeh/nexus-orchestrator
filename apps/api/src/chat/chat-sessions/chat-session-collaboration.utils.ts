export function sanitizeForJobId(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
  return sanitized.length > 0 ? sanitized : 'chat';
}
