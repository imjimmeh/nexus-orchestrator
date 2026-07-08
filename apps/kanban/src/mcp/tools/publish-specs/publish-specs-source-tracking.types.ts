type SourceSpecTrackingError = {
  source_path: string;
  message: string;
};

export type SourceSpecTrackingResult = {
  errors: SourceSpecTrackingError[];
  erroredSourceIds: Set<string>;
};
