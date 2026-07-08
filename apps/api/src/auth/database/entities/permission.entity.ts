import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { RolePermission } from './role-permission.entity';

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 100 })
  name: string; // 'workflows:read', 'users:create'

  @Column({ length: 50 })
  resource: string; // 'workflows', 'users', 'settings'

  @Column({ length: 20 })
  action: string; // 'read', 'create', 'update', 'delete', 'manage'

  @OneToMany(() => RolePermission, (rp) => rp.permission)
  rolePermissions: RolePermission[];
}
