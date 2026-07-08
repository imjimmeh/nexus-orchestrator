import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard.js';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator.js';
import { AssetImporterService } from './asset-importer.service.js';
import type {
  ImportRequestBody,
  PreviewResponse,
  ConfirmResponse,
} from './asset-import.controller.types.js';

/**
 * Exposes import preview and confirm endpoints for harness assets.
 *
 * Transport-only: all fetch, vet, checksum, and persistence logic lives in
 * `AssetImporterService`.
 *
 * Routes:
 * - `POST /harness/assets/import` — preview (no persist)
 * - `POST /harness/assets/import/confirm` — confirm + persist
 */
@ApiTags('harness')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('harness/assets/import')
export class AssetImportController {
  constructor(private readonly importerService: AssetImporterService) {}

  /**
   * Preview an import: fetch → vet → checksum WITHOUT persisting.
   *
   * POST /harness/assets/import
   *
   * Returns the manifest summary, canonical checksum, and pinned source.
   * NEVER persists. NEVER returns resolved secret env / header values.
   */
  @Post()
  @RequirePermission('settings:manage')
  async preview(@Body() body: ImportRequestBody): Promise<PreviewResponse> {
    const result = await this.importerService.prepareImport(body.source, {
      scopeNodeId: body.scopeNodeId,
    });

    return {
      kind: result.kind,
      manifest: result.manifest,
      checksum: result.checksum,
      pinnedSource: result.pinnedSource,
    };
  }

  /**
   * Confirm an import: run the pipeline at the pinned ref and persist the
   * immutable asset row.
   *
   * POST /harness/assets/import/confirm
   *
   * Returns `{ id }` of the newly created asset row.
   */
  @Post('confirm')
  @RequirePermission('settings:manage')
  async confirm(@Body() body: ImportRequestBody): Promise<ConfirmResponse> {
    const id = await this.importerService.confirmImport(body.source, {
      scopeNodeId: body.scopeNodeId,
    });

    return { id };
  }
}
