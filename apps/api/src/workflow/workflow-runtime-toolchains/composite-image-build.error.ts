/**
 * Thrown when a composite toolchain image fails to build under
 * {@link CompositeImageBuilderService}. Carries a NUL-sanitized, length-capped
 * tail of the Docker build log so callers can surface a useful diagnostic
 * without risking a DB write failure (see container-log-text.utils.ts).
 */
export class CompositeImageBuildError extends Error {
  constructor(
    message: string,
    readonly logTail: string,
  ) {
    super(message);
    this.name = 'CompositeImageBuildError';
  }
}
