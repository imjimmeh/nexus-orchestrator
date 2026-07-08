export function requireJwtSecret(): string {
  const value = process.env.JWT_SECRET;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('JWT_SECRET is required');
  }
  return value;
}
