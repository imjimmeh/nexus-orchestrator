export interface ModelSelectionStrategy {
  readonly priority: number;
  canSelect(useCase: string): boolean;
  selectModel(useCase: string): Promise<string | null>;
}
