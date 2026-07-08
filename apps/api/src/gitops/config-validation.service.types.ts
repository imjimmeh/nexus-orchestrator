import type { ValidationContext } from '@nexus/gitops-contracts';
import type { DesiredStateFile } from '@nexus/gitops-contracts';

export interface GitOpsLoadYamlTreeOptions {
  pathPrefix?: string;
}

export interface GitOpsFileLoader {
  loadYamlTree(
    dir: string,
    options?: GitOpsLoadYamlTreeOptions,
  ): Promise<DesiredStateFile[]>;
}

export interface ValidationContextProvider {
  build(): Promise<ValidationContext>;
}
