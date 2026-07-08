import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ExecutionRepository } from './database/repositories/execution.repository';
import {
  type ExecutionReadModel,
  toExecutionReadModel,
} from './execution-read.types';

@Controller('executions')
export class ExecutionsController {
  constructor(private readonly executionRepository: ExecutionRepository) {}

  @Get(':id')
  async getById(@Param('id') id: string): Promise<ExecutionReadModel> {
    const row = await this.executionRepository.findById(id);
    if (!row) {
      throw new NotFoundException(`Execution ${id} not found`);
    }
    return toExecutionReadModel(row);
  }
}
