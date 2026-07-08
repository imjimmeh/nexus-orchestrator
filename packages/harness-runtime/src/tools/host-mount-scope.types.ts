export interface HostMountScopeBinding {
  alias: string;
  hostPath: string;
  containerPath: string;
  mode: "ro" | "rw";
  readOnly: boolean;
}
