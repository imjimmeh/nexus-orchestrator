export interface SecretOption {
  id: string;
  name: string;
}

export interface SecretOptionsState {
  secrets: SecretOption[];
  isError: boolean;
}
