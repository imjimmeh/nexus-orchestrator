import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

@Entity('scope_node_closure')
@Index('idx_scope_closure_descendant', ['descendantId'])
export class ScopeNodeClosure {
  @PrimaryColumn({ name: 'ancestor_id', type: 'uuid' })
  ancestorId: string;

  @PrimaryColumn({ name: 'descendant_id', type: 'uuid' })
  descendantId: string;

  @Column({ type: 'int' })
  depth: number;
}
