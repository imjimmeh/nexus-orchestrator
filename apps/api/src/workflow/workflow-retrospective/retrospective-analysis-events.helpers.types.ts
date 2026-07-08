export interface RejectedFindingEventParams {
  findingIndex: number;
  terminalOutcome: string;
  reasonCode: string;
  issues?: string[];
  lessonSnippet?: string;
  outcome?: 'success' | 'failure';
  errorMessage?: string;
}
