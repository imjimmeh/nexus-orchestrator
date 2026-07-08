import { NotFoundException } from '@nestjs/common';
import { ICrudService } from './crud.service.interface';

/**
 * Abstract Base CRUD Service
 *
 * Provides a reusable implementation of standard CRUD operations.
 * Entity-specific services should extend this class and provide
 * their repository and entity name.
 */
export abstract class BaseCrudService<
  T,
  CreateDto,
  UpdateDto,
> implements ICrudService<T, CreateDto, UpdateDto> {
  constructor(
    protected readonly repository: {
      findAll(): Promise<T[]>;
      findById(id: string): Promise<T | null>;
      create(data: unknown): Promise<T>;
      update(id: string, data: unknown): Promise<T | null>;
      remove(id: string): Promise<void>;
    },
    protected readonly entityName: string,
  ) {}

  async findAll(): Promise<T[]> {
    return this.repository.findAll();
  }

  async findById(id: string): Promise<T | null> {
    return this.repository.findById(id);
  }

  async create(data: CreateDto): Promise<T> {
    return this.repository.create(data);
  }

  async update(id: string, data: UpdateDto): Promise<T | null> {
    return this.repository.update(id, data);
  }

  async remove(id: string): Promise<void> {
    await this.findByIdOrThrow(id);
    await this.repository.remove(id);
  }

  async findByIdOrThrow(id: string): Promise<T> {
    const entity = await this.findById(id);
    if (!entity) {
      throw new NotFoundException(`${this.entityName} with ID ${id} not found`);
    }
    return entity;
  }
}
