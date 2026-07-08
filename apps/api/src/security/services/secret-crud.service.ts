import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CreateSecretRequest, UpdateSecretRequest } from '@nexus/core';
import { BaseCrudService } from '../../ai-config/services/crud/base-crud.service';
import { SecretStore } from '../database/entities/secret-store.entity';
import { SecretStoreRepository } from '../database/repositories/secret-store.repository';
import { SecretVaultService } from '../secret-vault.service';

@Injectable()
export class SecretCrudService extends BaseCrudService<
  SecretStore,
  CreateSecretRequest,
  UpdateSecretRequest
> {
  private readonly logger = new Logger(SecretCrudService.name);

  constructor(
    protected readonly repository: SecretStoreRepository,
    private readonly vault: SecretVaultService,
  ) {
    super(repository, 'Secret');
  }

  async findAll(options?: { scopeIds?: string[] }): Promise<SecretStore[]> {
    const items = await this.repository.findAll(options);
    return items.map((item) => this.sanitizeSecret(item));
  }

  async findById(id: string): Promise<SecretStore | null> {
    const secret = await super.findById(id);
    if (!secret) {
      return null;
    }
    return this.sanitizeSecret(secret);
  }

  async findByIdRaw(
    id: string,
  ): Promise<{ id: string; decryptedValue: string } | null> {
    const secret = await super.findById(id);
    if (!secret) {
      return null;
    }

    try {
      const decrypted = this.vault.decrypt(secret.encrypted_value);
      return { id: secret.id, decryptedValue: decrypted };
    } catch (error) {
      this.logger.error(
        `Failed to decrypt secret ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new NotFoundException(`Secret ${id} could not be decrypted`);
    }
  }

  async create(data: CreateSecretRequest): Promise<SecretStore> {
    const encryptedValue = this.vault.encrypt(JSON.stringify(data.value));
    const payload: Partial<SecretStore> = {
      name: data.name,
      encrypted_value: encryptedValue,
      metadata: data.metadata || {},
    };

    const created = await this.repository.create(payload);
    return this.sanitizeSecret(created);
  }

  async update(
    id: string,
    data: UpdateSecretRequest,
  ): Promise<SecretStore | null> {
    await this.findByIdOrThrow(id);

    const payload: Partial<SecretStore> = {};

    if (data.name !== undefined) {
      payload.name = data.name;
    }
    if (data.value !== undefined) {
      payload.encrypted_value = this.vault.encrypt(JSON.stringify(data.value));
    }
    if (data.metadata !== undefined) {
      payload.metadata = data.metadata;
    }

    const updated = await this.repository.update(id, payload);
    if (!updated) {
      return null;
    }

    return this.sanitizeSecret(updated);
  }

  async upsertByName(
    data: CreateSecretRequest,
  ): Promise<{ secret: SecretStore; created: boolean }> {
    const existing = await this.repository.findByName(data.name);
    if (!existing) {
      return { secret: await this.create(data), created: true };
    }

    const updated = await this.update(existing.id, data);
    if (!updated) {
      throw new NotFoundException(`Secret with ID ${existing.id} not found`);
    }

    return { secret: updated, created: false };
  }

  private sanitizeSecret(secret: SecretStore): SecretStore {
    return {
      id: secret.id,
      name: secret.name,
      metadata: secret.metadata,
      created_at: secret.created_at,
      updated_at: secret.updated_at,
    } as SecretStore;
  }
}
