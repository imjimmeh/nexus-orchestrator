import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  specialStepPluginManifestSchema,
  type SpecialStepPlugin,
  type SpecialStepPluginHandler,
  type SpecialStepPluginManifest,
} from '@nexus/plugin-sdk';
import { existsSync } from 'node:fs';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { StepSpecialStepRegistryService } from '../step-special-step-registry.service';
import type {
  ISpecialStepHandler,
  SpecialStepExecutionContext,
  SpecialStepHandlerResult,
} from '../step-special-step.types';

const PLUGIN_MANIFEST_FILE = 'nexus.plugin.json';

@Injectable()
export class SpecialStepPluginLoaderService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SpecialStepPluginLoaderService.name);

  constructor(private readonly registry: StepSpecialStepRegistryService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.loadPlugins(process.env.NEXUS_SPECIAL_STEP_PLUGIN_DIR);
  }

  async loadPlugins(pluginDirectory?: string): Promise<void> {
    const configuredPluginDirectory = pluginDirectory?.trim();
    if (!configuredPluginDirectory) {
      return;
    }

    if (!existsSync(configuredPluginDirectory)) {
      this.logger.warn(
        `Special step plugin directory does not exist: ${configuredPluginDirectory}`,
      );
      return;
    }

    const entries = await readdir(configuredPluginDirectory, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      await this.loadPluginPackage(join(configuredPluginDirectory, entry.name));
    }
  }

  private async loadPluginPackage(packageDirectory: string): Promise<void> {
    const manifest = await this.readManifest(packageDirectory);
    const plugin = await this.importPlugin(packageDirectory, manifest);

    if (plugin.manifest.id !== manifest.id) {
      throw new Error(
        `Plugin ${manifest.id} export manifest id '${plugin.manifest.id}' does not match nexus.plugin.json id '${manifest.id}'`,
      );
    }

    this.validateExportedPluginHandlers(manifest.id, plugin.handlers);

    for (const specialStep of manifest.specialSteps) {
      const pluginHandler = plugin.handlers.find(
        (handler) => handler.type === specialStep.type,
      );

      if (!pluginHandler) {
        throw new Error(
          `Plugin ${manifest.id} manifest declares special step '${specialStep.type}' but no matching handler was exported`,
        );
      }

      this.registry.registerPluginHandler(
        this.createRegistryHandler(manifest, specialStep, pluginHandler),
      );
    }
  }

  private async readManifest(
    packageDirectory: string,
  ): Promise<SpecialStepPluginManifest> {
    const manifestPath = join(packageDirectory, PLUGIN_MANIFEST_FILE);
    if (!existsSync(manifestPath)) {
      throw new Error(
        `Special step plugin package missing nexus.plugin.json: ${packageDirectory}`,
      );
    }

    const rawManifest = await readFile(manifestPath, 'utf8');
    let parsedManifest: unknown;
    try {
      parsedManifest = JSON.parse(rawManifest);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Invalid special step plugin manifest at ${manifestPath}: ${message}`,
        { cause: error },
      );
    }

    const result = specialStepPluginManifestSchema.safeParse(parsedManifest);

    if (!result.success) {
      throw new Error(
        `Invalid special step plugin manifest at ${manifestPath}: ${result.error.message}`,
      );
    }

    return result.data;
  }

  private async importPlugin(
    packageDirectory: string,
    manifest: SpecialStepPluginManifest,
  ): Promise<SpecialStepPlugin> {
    const entrypointPath = await this.resolveEntrypointPath(
      packageDirectory,
      manifest,
    );
    const importedModule = (await import(
      pathToFileURL(entrypointPath).href
    )) as { default?: unknown };
    const plugin = importedModule.default;

    if (!isSpecialStepPlugin(plugin)) {
      throw new Error(
        `Plugin ${manifest.id} entrypoint default export must be a SpecialStepPlugin object`,
      );
    }

    return plugin;
  }

  private async resolveEntrypointPath(
    packageDirectory: string,
    manifest: SpecialStepPluginManifest,
  ): Promise<string> {
    const packagePath = resolve(packageDirectory);
    const entrypointPath = resolve(packagePath, manifest.entrypoint);
    const relativeEntrypoint = relative(packagePath, entrypointPath);

    if (
      isAbsolute(manifest.entrypoint) ||
      relativeEntrypoint.startsWith('..') ||
      isAbsolute(relativeEntrypoint)
    ) {
      throw new Error(
        `Plugin ${manifest.id} entrypoint '${manifest.entrypoint}' resolves outside plugin package directory`,
      );
    }

    const entrypointStats = await stat(entrypointPath);
    if (!entrypointStats.isFile()) {
      throw new Error(
        `Plugin ${manifest.id} entrypoint '${manifest.entrypoint}' is not a file`,
      );
    }

    const canonicalPackagePath = await realpath(packagePath);
    const canonicalEntrypointPath = await realpath(entrypointPath);
    const canonicalRelativeEntrypoint = relative(
      canonicalPackagePath,
      canonicalEntrypointPath,
    );

    if (
      canonicalRelativeEntrypoint.startsWith('..') ||
      isAbsolute(canonicalRelativeEntrypoint)
    ) {
      throw new Error(
        `Plugin ${manifest.id} entrypoint '${manifest.entrypoint}' resolves outside plugin package directory`,
      );
    }

    return entrypointPath;
  }

  private createRegistryHandler(
    manifest: SpecialStepPluginManifest,
    specialStep: SpecialStepPluginManifest['specialSteps'][number],
    handler: SpecialStepPluginHandler,
  ): ISpecialStepHandler {
    return {
      type: specialStep.type,
      descriptor: {
        type: specialStep.type,
        owningDomain: 'plugin',
        pluginId: manifest.id,
        displayName: specialStep.displayName,
        description: specialStep.description,
        inputContract: specialStep.inputContract,
      },
      execute: (context) =>
        this.executePluginHandler(
          manifest.id,
          specialStep.type,
          handler,
          context,
        ),
    };
  }

  private async executePluginHandler(
    pluginId: string,
    handlerType: string,
    handler: SpecialStepPluginHandler,
    context: SpecialStepExecutionContext,
  ): Promise<SpecialStepHandlerResult> {
    const result = await handler.execute(context);
    this.validatePluginHandlerResult(pluginId, handlerType, result);
    return result;
  }

  private validatePluginHandlerResult(
    pluginId: string,
    handlerType: string,
    value: unknown,
  ): asserts value is SpecialStepHandlerResult {
    if (!isRecordObject(value)) {
      throwInvalidPluginResult(
        pluginId,
        handlerType,
        'result wrapper must be an object',
      );
    }

    const executionResult = value.result;
    if (!isRecordObject(executionResult)) {
      throwInvalidPluginResult(
        pluginId,
        handlerType,
        'result must be an object',
      );
    }

    if (executionResult.status !== 'completed') {
      throwInvalidPluginResult(
        pluginId,
        handlerType,
        "result.status must be 'completed'",
      );
    }

    if (executionResult.source !== 'plugin') {
      throwInvalidPluginResult(
        pluginId,
        handlerType,
        "result.source must be 'plugin'",
      );
    }

    if (
      typeof executionResult.mode !== 'string' ||
      executionResult.mode.trim().length === 0
    ) {
      throwInvalidPluginResult(
        pluginId,
        handlerType,
        'result.mode must be a non-empty string',
      );
    }

    if (executionResult.mode !== handlerType) {
      throwInvalidPluginResult(
        pluginId,
        handlerType,
        `result.mode must match handler type '${handlerType}'`,
      );
    }

    if (!isRecordObject(value.output)) {
      throwInvalidPluginResult(
        pluginId,
        handlerType,
        'output must be a record object',
      );
    }
  }

  private validateExportedPluginHandlers(
    pluginId: string,
    handlers: SpecialStepPluginHandler[],
  ): void {
    for (const [index, handler] of handlers.entries()) {
      this.validatePluginHandler(pluginId, index, handler);
    }
  }

  private validatePluginHandler(
    pluginId: string,
    index: number,
    handler: SpecialStepPluginHandler,
  ): void {
    if (typeof handler.type !== 'string' || handler.type.trim().length === 0) {
      throw new Error(
        `Plugin ${pluginId} exported handler at index ${index} must have a non-empty string type`,
      );
    }

    if (typeof handler.execute !== 'function') {
      throw new Error(
        `Plugin ${pluginId} exported handler for special step '${handler.type}' must have a function execute`,
      );
    }
  }
}

function isSpecialStepPlugin(value: unknown): value is SpecialStepPlugin {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<SpecialStepPlugin>;
  return Boolean(
    candidate.manifest &&
    typeof candidate.manifest.id === 'string' &&
    Array.isArray(candidate.handlers),
  );
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function throwInvalidPluginResult(
  pluginId: string,
  handlerType: string,
  reason: string,
): never {
  throw new Error(
    `Plugin ${pluginId} handler '${handlerType}' returned invalid result: ${reason}`,
  );
}
