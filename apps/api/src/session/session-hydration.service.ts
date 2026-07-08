import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ContainerOrchestratorService } from '../docker/container-orchestrator.service';
import { PiSessionTreeRepository } from '../runtime/database/repositories/pi-session-tree.repository';
import { JSONLValidationService } from './jsonl-validation.service';
import { SecretScannerService } from '../security/secret-scanner.service';
import * as zlib from 'node:zlib';
import * as tar from 'tar-stream';
import { promisify } from 'node:util';
import { DOCKER_CLIENT } from '../docker/docker.constants';
import Docker from 'dockerode';
import { TokenCounterService } from '../memory/token-counter.service';
import { DistillationThresholdService } from '../memory/distillation-threshold.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { AiConfigurationService } from '../ai-config/ai-configuration.service';
import { TELEMETRY_GATEWAY } from '../shared/interfaces/telemetry-gateway.interface';
import { type ITelemetryGateway } from '../shared/interfaces/telemetry-gateway.interface';
import { ChatSessionRepository } from '../chat/database/repositories/chat-session.repository';
import { CONTAINER_SESSION_PATH } from '@nexus/core';
import { resolveContinuationParentId } from './session-tree-branch.helpers';

const gzip = promisify(zlib.gzip);
const unzip = promisify(zlib.unzip);
const DEFAULT_SESSION_FILE_PATH = CONTAINER_SESSION_PATH;
const LEGACY_PI_RUNNER_SESSION_FILE_PATH =
  '/opt/pi-runner/.pi/agent/session.jsonl';
const LEGACY_SESSION_FILE_PATH = '/app/.pi/agent/session.jsonl';
const WORKSPACE_SESSION_FILE_PATH = '/workspace/.pi/agent/session.jsonl';

@Injectable()
export class SessionHydrationService {
  private readonly logger = new Logger(SessionHydrationService.name);

  constructor(
    private readonly containerOrchestrator: ContainerOrchestratorService,
    private readonly sessionTreeRepo: PiSessionTreeRepository,
    private readonly chatSessionRepo: ChatSessionRepository,
    private readonly validationService: JSONLValidationService,
    private readonly secretScanner: SecretScannerService,
    private readonly tokenCounter: TokenCounterService,
    private readonly aiConfig: AiConfigurationService,
    private readonly distillationThreshold: DistillationThresholdService,
    @InjectQueue('distillation') private readonly distillationQueue: Queue,
    @Inject(DOCKER_CLIENT) private readonly docker: Docker,
    private readonly moduleRef: ModuleRef,
  ) {}

  private get telemetryGateway(): ITelemetryGateway {
    const gateway = this.moduleRef.get<ITelemetryGateway>(TELEMETRY_GATEWAY, {
      strict: false,
    });
    if (!gateway) {
      throw new Error(
        'TELEMETRY_GATEWAY resolved to null — TelemetryModule must provide the real gateway',
      );
    }
    return gateway;
  }

  async dehydrateSession(
    containerId: string,
    workflowRunId: string,
  ): Promise<string> {
    this.logger.log(`Dehydrating session for container ${containerId}`);

    await this.telemetryGateway.sendDehydrateCommand(containerId);

    const sessionTreeId = await this.extractAndPersistSession(containerId, {
      workflow_run_id: workflowRunId,
    });

    await this.enqueueDistillationIfNeeded(sessionTreeId);

    await this.containerOrchestrator.killContainer(containerId);
    await this.containerOrchestrator.removeContainer(containerId);

    return sessionTreeId;
  }

  async saveSessionFromExitedContainer(
    containerId: string,
    workflowRunId: string,
  ): Promise<string> {
    return this.extractAndPersistSession(containerId, {
      workflow_run_id: workflowRunId,
    });
  }

  async saveSessionForChat(
    containerId: string,
    chatSessionId: string,
  ): Promise<string> {
    return this.extractAndPersistSession(containerId, {
      chat_session_id: chatSessionId,
    });
  }

  async saveSessionForWorkflowChat(
    containerId: string,
    workflowRunId: string,
    chatSessionId: string,
  ): Promise<string> {
    const sessionTreeId = await this.extractAndPersistSession(containerId, {
      workflow_run_id: workflowRunId,
      chat_session_id: chatSessionId,
    });

    await this.chatSessionRepo.update(chatSessionId, {
      session_tree_id: sessionTreeId,
    });

    return sessionTreeId;
  }

  /**
   * Validates, secret-scans, compresses, and persists a JSONL string directly
   * to the session tree store without extracting from a container. Used on the
   * reap path where the PI engine's session.jsonl is already available on the
   * Docker host via the bind-mounted sidecar directory.
   *
   * Applies the same validation and secret-scan pipeline as
   * {@link extractAndPersistSession} so the stored tree is always clean.
   *
   * @param jsonlString         - Raw JSONL content (newline-separated JSON objects).
   * @param ownerRef            - Ownership reference for the session tree record.
   * @param options.containerTier - Stored container tier (1=LIGHT, 2=HEAVY).
   *   When provided, overrides the LIGHT default used when no containerId is
   *   available, ensuring HEAVY PI sessions are resumed on the correct image.
   * @returns The new session tree's UUID.
   */
  async saveSessionFromJsonl(
    jsonlString: string,
    ownerRef: {
      workflow_run_id?: string;
      chat_session_id?: string;
    },
    options?: { containerTier?: number },
  ): Promise<string> {
    return this.persistSessionFromJsonl(
      jsonlString,
      ownerRef,
      undefined,
      options?.containerTier,
    );
  }

  private async extractAndPersistSession(
    containerId: string,
    ownerRef: {
      workflow_run_id?: string;
      chat_session_id?: string;
    },
  ): Promise<string> {
    const jsonlString = await this.extractSessionFile(containerId);
    return this.persistSessionFromJsonl(jsonlString, ownerRef, containerId);
  }

  /**
   * Core persist pipeline shared by {@link extractAndPersistSession} and
   * {@link saveSessionFromJsonl}. Validates, secret-scans, compresses, and
   * writes the session tree record.
   *
   * @param jsonlString    - Raw JSONL content.
   * @param ownerRef       - Ownership reference for the session tree record.
   * @param containerId    - Optional; when provided, the container's tier label
   *                         is read from Docker. Takes precedence over
   *                         `explicitTier`.
   * @param explicitTier   - Optional; used when `containerId` is absent (e.g.
   *                         the host-file reap path). When neither is supplied
   *                         the tier defaults to 1 (LIGHT).
   */
  private async persistSessionFromJsonl(
    jsonlString: string,
    ownerRef: {
      workflow_run_id?: string;
      chat_session_id?: string;
    },
    containerId?: string,
    explicitTier?: number,
  ): Promise<string> {
    const ownerId =
      ownerRef.workflow_run_id ?? ownerRef.chat_session_id ?? 'unknown';

    const jsonlValidation = this.validationService.validateJSONL(jsonlString);
    if (!jsonlValidation.valid) {
      throw new BadRequestException(
        `Invalid JSONL data: ${jsonlValidation.errors.join(', ')}`,
      );
    }

    const lines = jsonlString.split('\n').filter((l) => l.trim().length > 0);
    const nodes = lines.map((l) => JSON.parse(l) as Record<string, unknown>);

    const treeValidation = this.validationService.validateTreeStructure(nodes);
    if (!treeValidation.valid) {
      throw new BadRequestException(
        `Invalid conversation tree: ${treeValidation.errors.join(', ')}`,
      );
    }

    const { redactedNodes, foundSecrets } = this.secretScanner.scanJSONL(nodes);
    if (foundSecrets) {
      this.logger.warn(`Redacted secrets in session for ${ownerId}`);
    }
    const safeJsonlString = redactedNodes
      .map((n) => JSON.stringify(n))
      .join('\n');

    const compressedBuffer = await gzip(Buffer.from(safeJsonlString, 'utf-8'));
    const base64Data = compressedBuffer.toString('base64');

    const lastNode = redactedNodes.at(-1) as { id?: string } | undefined;
    const lastNodeId = lastNode?.id || '';

    let tierLabel = explicitTier ?? 1;
    if (containerId) {
      // Docker label is the authoritative source when a live container is available.
      const container = this.docker.getContainer(containerId);
      const containerInfo = (await container.inspect()) as {
        Config: { Labels: Record<string, string> };
      };
      tierLabel = containerInfo.Config.Labels['nexus.tier'] === 'HEAVY' ? 2 : 1;
    }

    const sessionTree = await this.sessionTreeRepo.create({
      ...ownerRef,
      container_tier: tierLabel,
      jsonl_data: [base64Data],
      last_leaf_node_id: lastNodeId,
    });

    this.logger.log(`Saved session tree ${sessionTree.id} for ${ownerId}`);

    return sessionTree.id;
  }

  private async enqueueDistillationIfNeeded(
    sessionTreeId: string,
  ): Promise<void> {
    const tree = await this.sessionTreeRepo.findById(sessionTreeId);
    if (!tree) return;

    const base64Data = String(tree.jsonl_data[0]);
    const decompressed = await unzip(Buffer.from(base64Data, 'base64'));
    const lines = decompressed
      .toString('utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    const nodes = lines.map((l) => JSON.parse(l) as Record<string, unknown>);

    const model = await this.aiConfig.getModelForUseCase('session');
    const distillationModel =
      await this.aiConfig.getModelForUseCase('distillation');

    // Resolve the trigger threshold fresh on every enqueue attempt so a
    // runtime SystemSetting / ProjectGoal-override update takes effect
    // without restarting the worker. The resolver is the single source
    // of truth: it walks the 3-tier precedence chain
    // (per-resource SystemSetting > global SystemSetting > ProjectGoal
    // override metadata > hardcoded default) and emits a
    // `MemorySettingChanged` event when the resolved `(value, source)`
    // tuple drifts from the previous resolution. We pass the
    // sessionTreeId as the resourceId; the per-resource SystemSetting
    // is keyed on it directly, and the ProjectGoal override accessor
    // (no-op in production today, followup bridge lands the real
    // implementation) translates it to the upstream scope lookup.
    // Until the bridge lands the resolver falls through to the global
    // SystemSetting or the hardcoded 0.8 default, both of which are
    // honoured today.
    const { value: threshold, source: thresholdSource } =
      await this.distillationThreshold.resolve(sessionTreeId);

    if (await this.tokenCounter.isOverThreshold(nodes, model, threshold)) {
      await this.distillationQueue.add('distill-session', {
        sessionTreeId,
        model: distillationModel,
        threshold,
        thresholdSource,
      });
      this.logger.log(
        `Queued distillation for session tree ${sessionTreeId} (threshold=${threshold} source=${thresholdSource})`,
      );
    } else {
      this.logger.debug?.(
        `Distillation skipped for session tree ${sessionTreeId} (threshold=${threshold} source=${thresholdSource})`,
      );
    }
  }

  async findSessionTree(sessionTreeId: string) {
    return this.sessionTreeRepo.findById(sessionTreeId);
  }

  async findSessionTreeByWorkflowRunId(workflowRunId: string) {
    return this.sessionTreeRepo.findByWorkflowRunId(workflowRunId);
  }

  async rehydrateSession(
    sessionTreeId: string,
    containerId: string,
    nodeId?: string,
  ): Promise<string> {
    this.logger.log(
      `Rehydrating session ${sessionTreeId} into container ${containerId}`,
    );

    // 1. Retrieve JSONL from PiSessionTrees table
    const sessionTree = await this.sessionTreeRepo.findById(sessionTreeId);
    if (!sessionTree) {
      throw new NotFoundException(`Session tree ${sessionTreeId} not found`);
    }

    // 2. Decompress JSONL data
    const base64Data = String(sessionTree.jsonl_data[0]);
    const compressedBuffer = Buffer.from(base64Data, 'base64');
    const decompressedBuffer = await unzip(compressedBuffer);
    const jsonlString = decompressedBuffer.toString('utf-8');

    // 3. If nodeId provided, validate it exists in tree
    if (nodeId) {
      const lines = jsonlString.split('\n').filter((l) => l.trim().length > 0);
      const nodes = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
      const nodeExists = nodes.some((n) => n.id === nodeId);
      if (!nodeExists) {
        throw new BadRequestException(
          `Node ID ${nodeId} not found in session tree`,
        );
      }
    }

    // 4. Inject via docker.putArchive() to the runner session directory
    await this.injectSessionIntoContainer(containerId, jsonlString);

    // 5. Start container
    const container = this.docker.getContainer(containerId);
    await container.start();

    return containerId;
  }

  async injectSessionIntoContainer(
    containerId: string,
    sessionTreeIdOrJsonl: string,
  ): Promise<void> {
    let jsonlString: string;

    // If it looks like a UUID, treat it as a session tree ID and load from DB
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidPattern.test(sessionTreeIdOrJsonl)) {
      const sessionTree =
        await this.sessionTreeRepo.findById(sessionTreeIdOrJsonl);
      if (!sessionTree) {
        throw new NotFoundException(
          `Session tree ${sessionTreeIdOrJsonl} not found`,
        );
      }
      const base64Data = String(sessionTree.jsonl_data[0]);
      const compressedBuffer = Buffer.from(base64Data, 'base64');
      const decompressedBuffer = await unzip(compressedBuffer);
      jsonlString = decompressedBuffer.toString('utf-8');
    } else {
      jsonlString = sessionTreeIdOrJsonl;
    }

    const container = this.docker.getContainer(containerId);
    const sessionDirs =
      await this.resolveSessionDirectoryCandidates(containerId);

    let putArchiveError: unknown;
    let injected = false;
    for (const sessionDir of sessionDirs) {
      try {
        const archive = this.createTarStream('session.jsonl', jsonlString);
        await container.putArchive(archive, { path: sessionDir });
        injected = true;
        break;
      } catch (error) {
        putArchiveError = error;
      }
    }

    if (!injected) {
      if (putArchiveError instanceof Error) {
        throw putArchiveError;
      }
      throw new Error(
        `Failed to inject session archive into container ${containerId}`,
      );
    }

    this.logger.log(`Injected session into container ${containerId}`);
  }

  async appendSystemResultNode(
    sessionTreeId: string,
    content: string,
    explicitParentId?: string,
  ): Promise<string> {
    const sessionTree = await this.sessionTreeRepo.findById(sessionTreeId);
    if (!sessionTree) {
      throw new NotFoundException(`Session tree ${sessionTreeId} not found`);
    }

    const base64Data = String(sessionTree.jsonl_data[0]);
    const compressedBuffer = Buffer.from(base64Data, 'base64');
    const decompressedBuffer = await unzip(compressedBuffer);
    const jsonlString = decompressedBuffer.toString('utf-8');

    const nodes = jsonlString
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    // Attach past any trailing interrupted (aborted/empty) assistant turn. A
    // durable-await suspend leaves such a turn as the leaf; parenting the result
    // under it keeps it in the active branch and the pi SDK then rejects the
    // resume with "Cannot continue from message role: assistant". See the
    // session-tree-branch helper for the full rationale.
    const requestedParentId =
      explicitParentId || sessionTree.last_leaf_node_id || '';
    const parentId = resolveContinuationParentId(nodes, requestedParentId);

    const newNodeId = randomUUID();
    const newNode: Record<string, unknown> = {
      id: newNodeId,
      type: 'custom_message',
      parentId: parentId || undefined,
      customType: 'nexus_system',
      content,
      created_at: new Date().toISOString(),
    };

    nodes.push(newNode);
    const updatedJsonl = nodes.map((n) => JSON.stringify(n)).join('\n');
    const updatedCompressed = await gzip(Buffer.from(updatedJsonl, 'utf-8'));
    const updatedBase64 = updatedCompressed.toString('base64');

    await this.sessionTreeRepo.update(sessionTreeId, {
      jsonl_data: [updatedBase64],
      last_leaf_node_id: newNodeId,
    });

    return newNodeId;
  }

  private async extractSessionFile(containerId: string): Promise<string> {
    const container = this.docker.getContainer(containerId);
    const sessionPaths = await this.resolveSessionFileCandidates(containerId);

    let archiveError: unknown;
    for (const sessionPath of sessionPaths) {
      try {
        const archiveStream = await container.getArchive({
          path: sessionPath,
        });

        return await this.readSessionArchive(archiveStream);
      } catch (error) {
        archiveError = error;
      }
    }

    const sessionDirs =
      await this.resolveSessionDirectoryCandidates(containerId);
    for (const sessionDir of sessionDirs) {
      try {
        const archiveStream = await container.getArchive({
          path: sessionDir,
        });

        const discoveredJsonl = await this.readSessionArchive(archiveStream, {
          allowAnyJsonl: true,
        });
        if (discoveredJsonl.trim().length > 0) {
          return discoveredJsonl;
        }
      } catch (error) {
        archiveError = error;
      }
    }

    throw archiveError;
  }

  private async readSessionArchive(
    archiveStream: NodeJS.ReadableStream,
    options?: { allowAnyJsonl?: boolean },
  ): Promise<string> {
    return await new Promise((resolve, reject) => {
      const extract = tar.extract();
      const fileContents: Array<{ name: string; content: string }> = [];

      extract.on('entry', (header, stream, next) => {
        const isSessionJsonl = header.name.includes('session.jsonl');
        const isAnyJsonl =
          options?.allowAnyJsonl && header.name.endsWith('.jsonl');

        if (isSessionJsonl || isAnyJsonl) {
          let fileData = '';
          stream.on('data', (chunk: Buffer) => {
            fileData += chunk.toString('utf-8');
          });
          stream.on('end', () => {
            fileContents.push({ name: header.name, content: fileData });
            next();
          });
          stream.on('error', reject);
        } else {
          stream.on('end', () => {
            next();
          });
          stream.resume();
        }
      });

      extract.on('finish', () => {
        const preferred = fileContents.find((entry) =>
          entry.name.includes('session.jsonl'),
        );
        if (preferred) {
          resolve(preferred.content);
          return;
        }

        resolve(fileContents[0]?.content || '');
      });
      extract.on('error', reject);

      archiveStream.pipe(extract);
    });
  }

  private async resolveSessionFileCandidates(
    containerId: string,
  ): Promise<string[]> {
    const container = this.docker.getContainer(containerId);
    const containerInfo = (await container.inspect()) as {
      Config?: { Env?: string[] };
    };

    const env = containerInfo.Config?.Env || [];
    const sessionPathEnv = env.find((value) =>
      value.startsWith('SESSION_PATH='),
    );
    const configuredPath = sessionPathEnv?.slice('SESSION_PATH='.length);

    const candidates = [
      configuredPath,
      DEFAULT_SESSION_FILE_PATH,
      LEGACY_PI_RUNNER_SESSION_FILE_PATH,
      LEGACY_SESSION_FILE_PATH,
      WORKSPACE_SESSION_FILE_PATH,
    ].filter((value): value is string => Boolean(value));

    return [...new Set(candidates)];
  }

  private async resolveSessionDirectoryCandidates(
    containerId: string,
  ): Promise<string[]> {
    const filePaths = await this.resolveSessionFileCandidates(containerId);
    const directories = filePaths.map((filePath) =>
      filePath.slice(0, filePath.lastIndexOf('/')),
    );

    return [...new Set(directories.map((dir) => `${dir}/`))];
  }

  private createTarStream(
    filename: string,
    content: string,
  ): NodeJS.ReadableStream {
    const pack = tar.pack();
    pack.entry({ name: filename }, content);
    pack.finalize();

    return pack;
  }
}
