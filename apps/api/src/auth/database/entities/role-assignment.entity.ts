import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Role } from './role.entity';

@Entity('role_assignments')
@Index(
  'uq_role_assignments_user_role_scope',
  ['userId', 'roleId', 'scopeNodeId'],
  { unique: true },
)
@Index('idx_role_assignments_user', ['userId'])
@Index('idx_role_assignments_scope', ['scopeNodeId'])
export class RoleAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId: string;

  @Column({ name: 'scope_node_id', type: 'uuid' })
  scopeNodeId: string;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role: Role;
}
