import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('setup_config')
export class SetupConfig {
  @PrimaryColumn({ type: 'varchar', length: 50 })
  key: string = 'requires_setup';

  @Column({ type: 'boolean', default: true })
  requires_setup: boolean;
}
