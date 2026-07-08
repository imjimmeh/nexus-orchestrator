import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  AutomationHookActionType,
  AutomationHookTriggerType,
  IAutomationHook,
} from '@nexus/core';

@Entity('automation_hooks')
@Index('idx_automation_hooks_scope_trigger', ['scopeId', 'trigger_type'])
@Index('idx_automation_hooks_scope_enabled_priority', [
  'scopeId',
  'enabled',
  'priority',
])
export class AutomationHook implements IAutomationHook {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'scope_id', type: 'uuid' })
  scopeId: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({
    type: 'enum',
    enum: AutomationHookTriggerType,
  })
  trigger_type: AutomationHookTriggerType;

  @Column({ type: 'jsonb', nullable: true })
  trigger_filter?: Record<string, unknown> | null;

  @Column({ type: 'int', default: 100 })
  priority: number;

  @Column({
    type: 'enum',
    enum: AutomationHookActionType,
  })
  action_type: AutomationHookActionType;

  @Column({ type: 'jsonb', default: {} })
  action_payload: Record<string, unknown>;

  @Column({ type: 'int', default: 0 })
  cooldown_window_seconds: number;

  @Column({ type: 'timestamptz', nullable: true })
  last_fired_at?: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  created_by?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  updated_by?: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
