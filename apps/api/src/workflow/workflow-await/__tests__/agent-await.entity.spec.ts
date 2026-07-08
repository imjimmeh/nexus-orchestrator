import 'reflect-metadata';
import { getMetadataArgsStorage } from 'typeorm';
import { AgentAwaitEntity } from '../agent-await.entity';

describe('AgentAwaitEntity', () => {
  it('maps the agent_await table', () => {
    const table = getMetadataArgsStorage().tables.find(
      (t) => t.target === AgentAwaitEntity,
    );
    expect(table?.name).toBe('agent_await');
  });

  it('declares the parent_run_id column', () => {
    const cols = getMetadataArgsStorage().columns.filter(
      (c) => c.target === AgentAwaitEntity,
    );
    expect(
      cols.some((c) => (c.options.name ?? c.propertyName) === 'parent_run_id'),
    ).toBe(true);
  });

  it('declares the status column defaulting to WAITING', () => {
    const cols = getMetadataArgsStorage().columns.filter(
      (c) => c.target === AgentAwaitEntity,
    );
    const status = cols.find(
      (c) => (c.options.name ?? c.propertyName) === 'status',
    );
    expect(status?.options.default).toBe('WAITING');
  });

  it('declares jsonb columns for awaited and satisfied run ids', () => {
    const cols = getMetadataArgsStorage().columns.filter(
      (c) => c.target === AgentAwaitEntity,
    );
    const awaited = cols.find(
      (c) => (c.options.name ?? c.propertyName) === 'awaited_run_ids',
    );
    const satisfied = cols.find(
      (c) => (c.options.name ?? c.propertyName) === 'satisfied_run_ids',
    );
    expect(awaited?.options.type).toBe('jsonb');
    expect(satisfied?.options.type).toBe('jsonb');
  });
});
