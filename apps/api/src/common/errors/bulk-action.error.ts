import { BulkActionErrorCode } from './bulk-action.error.types';

export class BulkActionError extends Error {
  public readonly code: BulkActionErrorCode;
  public readonly ids: string[];

  constructor(code: BulkActionErrorCode, ids: string[]) {
    super(`Bulk action failed (${code}) for id(s): ${ids.join(', ')}`);
    this.name = 'BulkActionError';
    this.code = code;
    this.ids = ids;
  }
}
