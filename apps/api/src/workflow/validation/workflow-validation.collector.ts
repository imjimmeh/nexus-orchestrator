import {
  ValidationCollector,
  ValidationIssue,
} from './workflow-validation.types';

const DEFAULT_ERROR_CODE = 'workflow_validation_error';
const DEFAULT_WARNING_CODE = 'workflow_validation_warning';

export class DefaultValidationCollector implements ValidationCollector {
  private readonly issues: ValidationIssue[] = [];
  private readonly dedupe = new Set<string>();
  private readonly warnings: ValidationIssue[] = [];
  private readonly warningDedupe = new Set<string>();

  add(message: string, code = DEFAULT_ERROR_CODE, path?: string): void {
    const dedupeKey = `${code}|${path ?? ''}|${message}`;
    if (this.dedupe.has(dedupeKey)) {
      return;
    }

    this.dedupe.add(dedupeKey);
    this.issues.push({
      code,
      message,
      path,
    });
  }

  addWarning(
    message: string,
    code = DEFAULT_WARNING_CODE,
    path?: string,
  ): void {
    const dedupeKey = `${code}|${path ?? ''}|${message}`;
    if (this.warningDedupe.has(dedupeKey)) {
      return;
    }

    this.warningDedupe.add(dedupeKey);
    this.warnings.push({
      code,
      message,
      path,
    });
  }

  hasErrors(): boolean {
    return this.issues.length > 0;
  }

  toMessages(): string[] {
    return this.issues.map((issue) => issue.message);
  }

  toWarningMessages(): string[] {
    return this.warnings.map((issue) => issue.message);
  }
}
