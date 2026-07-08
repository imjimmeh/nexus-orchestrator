# EPIC-001: Authentication & Authorization System

> **Status:** Draft  
> **Priority:** High  
> **Estimate:** 3-5 days  
> **Created:** 2026-03-24  
> **Owner:** TBD

---

## 1. Epic Summary

Implement a complete self-hosted authentication and authorization system for Nexus Orchestrator with extensible RBAC foundation. The system uses shared Zod schemas in `@nexus/core` for type safety across frontend and backend, JWT tokens with refresh tokens for session management, and bcrypt for password hashing.

### Success Criteria
- [ ] Users can register (first user becomes admin automatically)
- [ ] Users can login with username/password + "Remember me"
- [ ] JWT access tokens expire after configurable time (default 15m)
- [ ] Refresh tokens rotate and support "Remember me" extended expiry
- [ ] Two roles exist: `admin` and `user` (extensible)
- [ ] Admins can perform full user management (CRUD + role assignment)
- [ ] Password requirements are configurable via environment
- [ ] All DTOs use Zod schemas from `@nexus/core` package
- [ ] 100% test coverage for auth service and guards
- [ ] Rate limiting prevents brute force attacks

---

## 2. Architecture Decision

### Selected Approach: Simple Roles with RBAC Foundation (Option 1)

**Rationale:**
- Meets current needs with 2 simple roles
- Built-in extensibility for granular permissions later
- Clean separation between authentication and authorization
- Follows NestJS conventions and best practices
- Supports future MFA addition without major refactoring

### Key Architectural Patterns

1. **Shared DTOs with Zod**: All request/response validation schemas defined once in `@nexus/core`, imported by both frontend and backend
2. **Token Rotation**: Refresh tokens are single-use; new access token returns new refresh token
3. **Soft Deletes**: Users are disabled, not deleted, preserving audit trails
4. **Environment-Driven Security**: Password policy, token expiry, bcrypt rounds all configurable
5. **Database Transactions**: Registration and role assignment atomic

---

## 3. Technical Stack

### Backend
- **Framework:** NestJS 11.x
- **ORM:** TypeORM 0.3.x
- **Password Hashing:** bcrypt (12 rounds default)
- **JWT:** @nestjs/jwt with passport-jwt
- **Validation:** Zod (via shared schemas from @nexus/core)
- **Rate Limiting:** @nestjs/throttler (already installed)

### Frontend
- **Framework:** React 18.x + TypeScript
- **State Management:** Zustand 4.x
- **HTTP Client:** Axios with interceptors
- **Validation:** Zod (shared from @nexus/core)
- **Forms:** React Hook Form + Zod resolver

### Shared
- **Package:** `@nexus/core`
- **Schemas:** Zod with TypeScript inference
- **Types:** Inferred from Zod schemas (no manual interfaces for DTOs)

---

## 4. Database Schema

### Entity Relationship Diagram

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│    User     │     │  UserRole    │     │    Role     │
├─────────────┤     ├──────────────┤     ├─────────────┤
│ PK id       │◄────┤ PK id        │────►│ PK id       │
│ username    │     │ FK user_id   │     │ name        │
│ email       │     │ FK role_id   │     │ description │
│ passwordHash│     └──────────────┘     └─────────────┘
│ isActive    │                              │
│ lastLoginAt │                              │
│ createdAt   │                              ▼
│ updatedAt   │                         ┌─────────────┐
└─────────────┘                         │RolePermission│
       │                                ├─────────────┤
       │                                │ PK id       │
       │                                │ FK role_id  │
       │                                │ FK perm_id  │
       ▼                                └─────────────┘
┌─────────────┐                                │
│RefreshToken │                                ▼
├─────────────┤                         ┌─────────────┐
│ PK id       │                         │  Permission │
│ FK user_id  │                         ├─────────────┤
│ token       │                         │ PK id       │
│ expiresAt   │                         │ name        │
│ isRevoked   │                         │ resource    │
│ deviceInfo  │                         │ action      │
└─────────────┘                         └─────────────┘
```

### Entity Definitions

#### User Entity
```typescript
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 50 })
  username: string;

  @Column({ unique: true })
  email: string;

  @Column({ name: 'password_hash', select: false })
  passwordHash: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamp', nullable: true, name: 'last_login_at' })
  lastLoginAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => UserRole, userRole => userRole.user, { cascade: true })
  userRoles: UserRole[];

  @OneToMany(() => RefreshToken, token => token.user)
  refreshTokens: RefreshToken[];
}
```

#### Role Entity
```typescript
@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 50 })
  name: string; // 'admin', 'user'

  @Column({ length: 255 })
  description: string;

  @OneToMany(() => UserRole, userRole => userRole.role)
  userRoles: UserRole[];

  @OneToMany(() => RolePermission, rp => rp.role)
  rolePermissions: RolePermission[];
}
```

#### UserRole Entity (Junction)
```typescript
@Entity('user_roles')
export class UserRole {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, user => user.userRoles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Role, role => role.userRoles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role: Role;
}
```

#### Permission Entity (Future-Proofing)
```typescript
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

  @OneToMany(() => RolePermission, rp => rp.permission)
  rolePermissions: RolePermission[];
}
```

#### RolePermission Entity (Junction - Future)
```typescript
@Entity('role_permissions')
export class RolePermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Role, role => role.rolePermissions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @ManyToOne(() => Permission, permission => permission.rolePermissions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'permission_id' })
  permission: Permission;
}
```

#### RefreshToken Entity
```typescript
@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'token_hash', select: false })
  tokenHash: string;

  @ManyToOne(() => User, user => user.refreshTokens, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'expires_at' })
  expiresAt: Date;

  @Column({ default: false })
  isRevoked: boolean;

  @Column({ nullable: true, name: 'device_info', length: 500 })
  deviceInfo: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

---

## 5. Shared Zod Schemas (@nexus/core)

### Directory Structure
```
packages/core/src/
├── index.ts
├── interfaces/
│   └── index.ts          # Existing workflow interfaces
└── schemas/
    ├── index.ts          # Export all schemas
    ├── auth/
    │   ├── index.ts
    │   ├── register.schema.ts
    │   ├── login.schema.ts
    │   ├── refresh-token.schema.ts
    │   └── tokens.schema.ts
    ├── users/
    │   ├── index.ts
    │   ├── create-user.schema.ts
    │   ├── update-user.schema.ts
    │   └── user-response.schema.ts
    ├── roles/
    │   ├── index.ts
    │   └── role.schema.ts
    └── common/
        ├── index.ts
        └── pagination.schema.ts
```

### Auth Schemas

#### Register Schema
```typescript
// packages/core/src/schemas/auth/register.schema.ts
import { z } from 'zod';

export const RegisterRequestSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be at most 50 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  
  email: z
    .string()
    .email('Invalid email address'),
  
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
});

export const RegisterResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    username: z.string(),
    email: z.string().email(),
    roles: z.array(z.enum(['admin', 'user'])),
    createdAt: z.string().datetime(),
  }),
  accessToken: z.string(),
  refreshToken: z.string(),
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;
```

#### Login Schema
```typescript
// packages/core/src/schemas/auth/login.schema.ts
import { z } from 'zod';

export const LoginRequestSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().default(false),
});

export const LoginResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    username: z.string(),
    email: z.string().email(),
    roles: z.array(z.enum(['admin', 'user'])),
    createdAt: z.string().datetime(),
  }),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(), // seconds
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
```

#### Refresh Token Schema
```typescript
// packages/core/src/schemas/auth/refresh-token.schema.ts
import { z } from 'zod';

export const RefreshTokenRequestSchema = z.object({
  refreshToken: z.string(),
});

export const RefreshTokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
});

export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;
export type RefreshTokenResponse = z.infer<typeof RefreshTokenResponseSchema>;
```

### User Schemas

#### Create User Schema
```typescript
// packages/core/src/schemas/users/create-user.schema.ts
import { z } from 'zod';
import { RegisterRequestSchema } from '../auth/register.schema';

export const CreateUserRequestSchema = RegisterRequestSchema.extend({
  role: z.enum(['admin', 'user']).default('user'),
  isActive: z.boolean().default(true),
});

export const CreateUserResponseSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  email: z.string().email(),
  roles: z.array(z.enum(['admin', 'user'])),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
});

export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;
export type CreateUserResponse = z.infer<typeof CreateUserResponseSchema>;
```

#### Update User Schema
```typescript
// packages/core/src/schemas/users/update-user.schema.ts
import { z } from 'zod';

export const UpdateUserRequestSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/).optional(),
  email: z.string().email().optional(),
  role: z.enum(['admin', 'user']).optional(),
  isActive: z.boolean().optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;
```

### Role Schemas
```typescript
// packages/core/src/schemas/roles/role.schema.ts
import { z } from 'zod';

export const RoleSchema = z.object({
  id: z.string().uuid(),
  name: z.enum(['admin', 'user']),
  description: z.string(),
});

export const RoleResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.enum(['admin', 'user']),
  description: z.string(),
  permissions: z.array(z.string()).optional(), // For future expansion
});

export type Role = z.infer<typeof RoleSchema>;
export type RoleResponse = z.infer<typeof RoleResponseSchema>;
```

### Common Schemas
```typescript
// packages/core/src/schemas/common/pagination.schema.ts
import { z } from 'zod';

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export const PaginationResponseSchema = z.object({
  data: z.array(z.any()),
  meta: z.object({
    total: z.number(),
    page: z.number(),
    limit: z.number(),
    totalPages: z.number(),
  }),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type PaginationResponse<T> = {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
};
```

---

## 6. API Endpoints

### Authentication Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/v1/auth/register` | Public | Register new user (first user = admin) |
| POST | `/api/v1/auth/login` | Public | Login with credentials |
| POST | `/api/v1/auth/refresh` | Public | Rotate refresh token |
| POST | `/api/v1/auth/logout` | Protected | Revoke current refresh token |
| POST | `/api/v1/auth/logout-all` | Protected | Revoke all user refresh tokens |
| GET | `/api/v1/auth/me` | Protected | Get current user info |

### User Management Endpoints (Admin Only)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/users` | Admin | List users with pagination |
| GET | `/api/v1/users/:id` | Admin | Get user details |
| POST | `/api/v1/users` | Admin | Create new user |
| PATCH | `/api/v1/users/:id` | Admin | Update user details |
| DELETE | `/api/v1/users/:id` | Admin | Disable/soft delete user |
| POST | `/api/v1/users/:id/reset-password` | Admin | Reset user password |

### Role Endpoints (Read-Only for Now)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/roles` | Protected | List all roles |
| GET | `/api/v1/roles/:id/permissions` | Protected | Get role permissions |

---

## 7. Implementation Tasks

### Phase 1: Setup & Shared Schemas (Day 1)

#### Task 1.1: Add Zod to @nexus/core
**Files:**
- Modify: `packages/core/package.json`

```json
{
  "dependencies": {
    "zod": "^3.22.4"
  }
}
```

**Step 1: Install dependency**
```bash
cd packages/core && npm install zod
```

**Step 2: Commit**
```bash
git add packages/core/package.json
npm install # update root lockfile
git commit -m "feat(core): add zod dependency for shared schemas"
```

---

#### Task 1.2: Create Auth Schemas in @nexus/core
**Files:**
- Create: `packages/core/src/schemas/auth/register.schema.ts`
- Create: `packages/core/src/schemas/auth/login.schema.ts`
- Create: `packages/core/src/schemas/auth/refresh-token.schema.ts`
- Create: `packages/core/src/schemas/auth/index.ts`
- Modify: `packages/core/src/schemas/index.ts`

**Implementation:** Use schemas defined in Section 5 above.

**Step 1: Create register schema**
```typescript
// Complete implementation from Section 5
```

**Step 2: Create login schema**
```typescript
// Complete implementation from Section 5
```

**Step 3: Create refresh token schema**
```typescript
// Complete implementation from Section 5
```

**Step 4: Create auth index**
```typescript
export * from './register.schema';
export * from './login.schema';
export * from './refresh-token.schema';
```

**Step 5: Update main schemas index**
```typescript
export * from './auth';
```

**Step 6: Commit**
```bash
git add packages/core/src/schemas/
git commit -m "feat(core): add authentication zod schemas"
```

---

#### Task 1.3: Create User Schemas in @nexus/core
**Files:**
- Create: `packages/core/src/schemas/users/create-user.schema.ts`
- Create: `packages/core/src/schemas/users/update-user.schema.ts`
- Create: `packages/core/src/schemas/users/user-response.schema.ts`
- Create: `packages/core/src/schemas/users/index.ts`
- Modify: `packages/core/src/schemas/index.ts`

**Step 1-4: Create schema files** (see Section 5)

**Step 5: Update schemas index**
```typescript
export * from './auth';
export * from './users';
```

**Step 6: Commit**
```bash
git add packages/core/src/schemas/
git commit -m "feat(core): add user management zod schemas"
```

---

#### Task 1.4: Create Role Schemas in @nexus/core
**Files:**
- Create: `packages/core/src/schemas/roles/role.schema.ts`
- Create: `packages/core/src/schemas/roles/index.ts`
- Modify: `packages/core/src/schemas/index.ts`

**Step 1-2: Create schema files** (see Section 5)

**Step 3: Update schemas index**
```typescript
export * from './auth';
export * from './users';
export * from './roles';
```

**Step 4: Commit**
```bash
git add packages/core/src/schemas/
git commit -m "feat(core): add role zod schemas"
```

---

#### Task 1.5: Create Common Schemas in @nexus/core
**Files:**
- Create: `packages/core/src/schemas/common/pagination.schema.ts`
- Create: `packages/core/src/schemas/common/index.ts`
- Modify: `packages/core/src/schemas/index.ts`

**Step 1: Create pagination schema** (see Section 5)

**Step 2: Update schemas index**
```typescript
export * from './auth';
export * from './users';
export * from './roles';
export * from './common';
```

**Step 3: Commit**
```bash
git add packages/core/src/schemas/
git commit -m "feat(core): add common pagination schemas"
```

---

#### Task 1.6: Build and Test @nexus/core
**Files:** All packages/core changes

**Step 1: Build package**
```bash
cd packages/core && npm run build
```

**Step 2: Verify exports**
```typescript
// Test in a temp file
import { RegisterRequestSchema, LoginRequestSchema } from '@nexus/core';
console.log(RegisterRequestSchema.parse({ ... })); // Should work
```

**Step 3: Commit**
```bash
git add packages/core/dist/
git commit -m "build(core): compile shared schemas"
```

---

### Phase 2: Backend Database Entities (Day 1-2)

#### Task 2.1: Create User Entity
**Files:**
- Create: `apps/api/src/database/entities/user.entity.ts`
- Create: `apps/api/src/database/entities/index.ts` (or modify existing)

**Implementation:**
```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { UserRole } from './user-role.entity';
import { RefreshToken } from './refresh-token.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 50 })
  username: string;

  @Column({ unique: true })
  email: string;

  @Column({ name: 'password_hash', select: false })
  passwordHash: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamp', nullable: true, name: 'last_login_at' })
  lastLoginAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => UserRole, userRole => userRole.user, { cascade: true })
  userRoles: UserRole[];

  @OneToMany(() => RefreshToken, token => token.user)
  refreshTokens: RefreshToken[];
}
```

**Step 1: Write entity**
**Step 2: Update entities barrel export**
**Step 3: Commit**
```bash
git add apps/api/src/database/entities/user.entity.ts
git commit -m "feat(api): add User entity"
```

---

#### Task 2.2: Create Role Entity
**Files:**
- Create: `apps/api/src/database/entities/role.entity.ts`

**Step 1-2: Write entity** (see Section 4)

**Step 3: Commit**
```bash
git add apps/api/src/database/entities/role.entity.ts
git commit -m "feat(api): add Role entity"
```

---

#### Task 2.3: Create UserRole Junction Entity
**Files:**
- Create: `apps/api/src/database/entities/user-role.entity.ts`

**Step 1-2: Write entity** (see Section 4)

**Step 3: Commit**
```bash
git add apps/api/src/database/entities/user-role.entity.ts
git commit -m "feat(api): add UserRole junction entity"
```

---

#### Task 2.4: Create Permission Entity (Future-Proofing)
**Files:**
- Create: `apps/api/src/database/entities/permission.entity.ts`

**Step 1-2: Write entity** (see Section 4)

**Step 3: Commit**
```bash
git add apps/api/src/database/entities/permission.entity.ts
git commit -m "feat(api): add Permission entity for future RBAC"
```

---

#### Task 2.5: Create RolePermission Junction Entity
**Files:**
- Create: `apps/api/src/database/entities/role-permission.entity.ts`

**Step 1-2: Write entity** (see Section 4)

**Step 3: Commit**
```bash
git add apps/api/src/database/entities/role-permission.entity.ts
git commit -m "feat(api): add RolePermission junction entity"
```

---

#### Task 2.6: Create RefreshToken Entity
**Files:**
- Create: `apps/api/src/database/entities/refresh-token.entity.ts`

**Step 1-2: Write entity** (see Section 4)

**Step 3: Commit**
```bash
git add apps/api/src/database/entities/refresh-token.entity.ts
git commit -m "feat(api): add RefreshToken entity"
```

---

#### Task 2.7: Create Entity Index Barrel
**Files:**
- Modify: `apps/api/src/database/entities/index.ts` (create if doesn't exist)

**Implementation:**
```typescript
export * from './user.entity';
export * from './role.entity';
export * from './user-role.entity';
export * from './permission.entity';
export * from './role-permission.entity';
export * from './refresh-token.entity';
// Re-export existing entities
export * from './workflow.entity';
export * from './workflow-run.entity';
// ... etc
```

**Step 1: Create barrel export**
**Step 2: Commit**
```bash
git add apps/api/src/database/entities/index.ts
git commit -m "feat(api): export all entities from barrel file"
```

---

#### Task 2.8: Create Repositories
**Files:**
- Create: `apps/api/src/database/repositories/user.repository.ts`
- Create: `apps/api/src/database/repositories/role.repository.ts`
- Create: `apps/api/src/database/repositories/user-role.repository.ts`
- Create: `apps/api/src/database/repositories/refresh-token.repository.ts`
- Create: `apps/api/src/database/repositories/index.ts`

**Implementation Example (user.repository.ts):**
```typescript
import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { User } from '../entities/user.entity';

@Injectable()
export class UserRepository extends Repository<User> {
  constructor(private dataSource: DataSource) {
    super(User, dataSource.createEntityManager());
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.findOne({ where: { username } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.findOne({ where: { email } });
  }

  async findWithRoles(userId: string): Promise<User | null> {
    return this.findOne({
      where: { id: userId },
      relations: ['userRoles', 'userRoles.role'],
    });
  }

  async countActive(): Promise<number> {
    return this.count({ where: { isActive: true } });
  }
}
```

**Step 1: Create user repository**
**Step 2: Create role repository**
**Step 3: Create user-role repository**
**Step 4: Create refresh-token repository**
**Step 5: Create barrel export**
**Step 6: Commit**
```bash
git add apps/api/src/database/repositories/
git commit -m "feat(api): add auth repositories"
```

---

#### Task 2.9: Update DatabaseModule
**Files:**
- Modify: `apps/api/src/database/database.module.ts`

**Add to entities array:**
```typescript
const entities = [
  // ... existing entities
  User,
  Role,
  UserRole,
  Permission,
  RolePermission,
  RefreshToken,
];
```

**Add to repositories array:**
```typescript
const repositories = [
  // ... existing repositories
  UserRepository,
  RoleRepository,
  UserRoleRepository,
  RefreshTokenRepository,
];
```

**Step 1: Update module**
**Step 2: Commit**
```bash
git add apps/api/src/database/database.module.ts
git commit -m "feat(api): register auth entities and repositories in DatabaseModule"
```

---

#### Task 2.10: Create Database Seeds
**Files:**
- Create: `apps/api/src/database/seeds/roles.seed.ts`
- Create: `apps/api/src/database/seeds/index.ts`

**Implementation:**
```typescript
import { DataSource } from 'typeorm';
import { Role } from '../entities/role.entity';

export const seedRoles = async (dataSource: DataSource): Promise<void> {
  const roleRepository = dataSource.getRepository(Role);
  
  const roles = [
    { name: 'admin', description: 'Full system access' },
    { name: 'user', description: 'Standard user access' },
  ];

  for (const roleData of roles) {
    const existing = await roleRepository.findOne({
      where: { name: roleData.name },
    });
    
    if (!existing) {
      await roleRepository.save(roleRepository.create(roleData));
      console.log(`Created role: ${roleData.name}`);
    }
  }
};
```

**Step 1: Create seed file**
**Step 2: Create barrel export**
**Step 3: Integrate into app bootstrap**
**Step 4: Commit**
```bash
git add apps/api/src/database/seeds/
git commit -m "feat(api): add role database seeds"
```

---

### Phase 3: Backend Auth Service (Day 2-3)

#### Task 3.1: Install bcrypt
**Files:**
- Modify: `apps/api/package.json`

**Step 1: Install package**
```bash
cd apps/api && npm install bcrypt
npm install --save-dev @types/bcrypt
```

**Step 2: Commit**
```bash
git add apps/api/package.json
git commit -m "chore(api): add bcrypt for password hashing"
```

---

#### Task 3.2: Create Password Validation Service
**Files:**
- Create: `apps/api/src/auth/password-validation.service.ts`
- Create: `apps/api/src/auth/password-validation.service.spec.ts`

**Implementation:**
```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RegisterRequestSchema } from '@nexus/core';

@Injectable()
export class PasswordValidationService {
  constructor(private configService: ConfigService) {}

  getPasswordRequirements() {
    return {
      minLength: this.configService.get('PASSWORD_MIN_LENGTH', 8),
      requireUppercase: this.configService.get('PASSWORD_REQUIRE_UPPERCASE', true),
      requireLowercase: this.configService.get('PASSWORD_REQUIRE_LOWERCASE', true),
      requireNumbers: this.configService.get('PASSWORD_REQUIRE_NUMBERS', true),
      requireSpecial: this.configService.get('PASSWORD_REQUIRE_SPECIAL', true),
    };
  }

  validatePassword(password: string): { valid: boolean; errors: string[] } {
    const requirements = this.getPasswordRequirements();
    const errors: string[] = [];

    if (password.length < requirements.minLength) {
      errors.push(`Password must be at least ${requirements.minLength} characters`);
    }

    if (requirements.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (requirements.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (requirements.requireNumbers && !/[0-9]/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    if (requirements.requireSpecial && !/[^A-Za-z0-9]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    return { valid: errors.length === 0, errors };
  }
}
```

**Step 1: Write service**
**Step 2: Write tests**
**Step 3: Commit**
```bash
git add apps/api/src/auth/password-validation.service.ts
git add apps/api/src/auth/password-validation.service.spec.ts
git commit -m "feat(api): add password validation service"
```

---

#### Task 3.3: Create Auth DTOs (Using Zod Validation Pipe)
**Files:**
- Create: `apps/api/src/auth/dto/register.dto.ts`
- Create: `apps/api/src/auth/dto/login.dto.ts`
- Create: `apps/api/src/auth/dto/refresh-token.dto.ts`
- Create: `apps/api/src/auth/dto/index.ts`

**Implementation (using Zod + ZodValidationPipe):**
```typescript
// apps/api/src/auth/dto/register.dto.ts
import { createZodDto } from 'nestjs-zod';
import { RegisterRequestSchema } from '@nexus/core';

export class RegisterDto extends createZodDto(RegisterRequestSchema) {}
```

**Step 1: Install nestjs-zod**
```bash
cd apps/api && npm install nestjs-zod
```

**Step 2: Create DTO files**
**Step 3: Commit**
```bash
git add apps/api/src/auth/dto/
git commit -m "feat(api): add auth DTOs with Zod validation"
```

---

#### Task 3.4: Create Token Service
**Files:**
- Create: `apps/api/src/auth/token.service.ts`
- Create: `apps/api/src/auth/token.service.spec.ts`

**Implementation:**
```typescript
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User } from '../database/entities/user.entity';

export interface TokenPayload {
  sub: string; // user id
  username: string;
  email: string;
  roles: string[];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class TokenService {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  generateTokens(user: User, roles: string[], rememberMe: boolean = false): TokenPair {
    const payload: TokenPayload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      roles,
    };

    const accessExpiry = this.configService.get('JWT_ACCESS_EXPIRY', '15m');
    const refreshExpiry = rememberMe
      ? this.configService.get('JWT_REFRESH_REMEMBER_ME', '30d')
      : this.configService.get('JWT_REFRESH_EXPIRY', '7d');

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: accessExpiry,
    });

    const expiresIn = this.parseExpiryToSeconds(accessExpiry);

    return {
      accessToken,
      refreshToken: '', // Generated separately for rotation
      expiresIn,
    };
  }

  private parseExpiryToSeconds(expiry: string): number {
    // Parse '15m', '7d', '30d' to seconds
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 900; // Default 15 minutes
    
    const [, value, unit] = match;
    const multipliers: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };
    
    return parseInt(value) * multipliers[unit];
  }

  verifyAccessToken(token: string): TokenPayload {
    return this.jwtService.verify<TokenPayload>(token);
  }
}
```

**Step 1: Write service**
**Step 2: Write tests**
**Step 3: Commit**
```bash
git add apps/api/src/auth/token.service.ts
git commit -m "feat(api): add token service for JWT generation"
```

---

#### Task 3.5: Create Refresh Token Service
**Files:**
- Create: `apps/api/src/auth/refresh-token.service.ts`
- Create: `apps/api/src/auth/refresh-token.service.spec.ts`

**Implementation:**
```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { RefreshTokenRepository } from '../database/repositories/refresh-token.repository';
import { User } from '../database/entities/user.entity';

@Injectable()
export class RefreshTokenService {
  constructor(
    private refreshTokenRepository: RefreshTokenRepository,
    private configService: ConfigService,
  ) {}

  async createRefreshToken(
    user: User,
    rememberMe: boolean = false,
    deviceInfo?: string,
  ): Promise<string> {
    const plainToken = crypto.randomBytes(64).toString('hex');
    const tokenHash = await bcrypt.hash(plainToken, 10); // Lower rounds for refresh tokens

    const expiryDays = rememberMe ? 30 : 7;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiryDays);

    await this.refreshTokenRepository.save(
      this.refreshTokenRepository.create({
        user,
        tokenHash,
        expiresAt,
        deviceInfo,
      }),
    );

    return plainToken;
  }

  async validateRefreshToken(token: string): Promise<User | null> {
    // Hash the incoming token and look it up
    const tokens = await this.refreshTokenRepository.find({
      where: { isRevoked: false },
      relations: ['user'],
    });

    for (const refreshToken of tokens) {
      if (await bcrypt.compare(token, refreshToken.tokenHash)) {
        if (refreshToken.expiresAt < new Date()) {
          return null; // Expired
        }
        return refreshToken.user;
      }
    }

    return null;
  }

  async revokeRefreshToken(token: string): Promise<void> {
    const tokens = await this.refreshTokenRepository.find();

    for (const refreshToken of tokens) {
      if (await bcrypt.compare(token, refreshToken.tokenHash)) {
        refreshToken.isRevoked = true;
        await this.refreshTokenRepository.save(refreshToken);
        return;
      }
    }
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.refreshTokenRepository.update(
      { user: { id: userId }, isRevoked: false },
      { isRevoked: true },
    );
  }
}
```

**Step 1: Write service**
**Step 2: Write tests**
**Step 3: Commit**
```bash
git add apps/api/src/auth/refresh-token.service.ts
git commit -m "feat(api): add refresh token service with rotation"
```

---

#### Task 3.6: Create Auth Service
**Files:**
- Create: `apps/api/src/auth/auth.service.ts`
- Create: `apps/api/src/auth/auth.service.spec.ts`

**Implementation:**
```typescript
import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserRepository } from '../database/repositories/user.repository';
import { RoleRepository } from '../database/repositories/role.repository';
import { UserRoleRepository } from '../database/repositories/user-role.repository';
import { PasswordValidationService } from './password-validation.service';
import { TokenService } from './token.service';
import { RefreshTokenService } from './refresh-token.service';
import {
  RegisterRequest,
  LoginRequest,
  RegisterResponse,
  LoginResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
} from '@nexus/core';

@Injectable()
export class AuthService {
  constructor(
    private userRepository: UserRepository,
    private roleRepository: RoleRepository,
    private userRoleRepository: UserRoleRepository,
    private passwordValidationService: PasswordValidationService,
    private tokenService: TokenService,
    private refreshTokenService: RefreshTokenService,
  ) {}

  async register(dto: RegisterRequest): Promise<RegisterResponse> {
    // Check if username exists
    const existingUser = await this.userRepository.findByUsername(dto.username);
    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    // Check if email exists
    const existingEmail = await this.userRepository.findByEmail(dto.email);
    if (existingEmail) {
      throw new ConflictException('Email already exists');
    }

    // Validate password
    const passwordCheck = this.passwordValidationService.validatePassword(dto.password);
    if (!passwordCheck.valid) {
      throw new ForbiddenException(passwordCheck.errors.join(', '));
    }

    // Hash password
    const passwordHash = await bcrypt.hash(dto.password, 12);

    // Create user
    const user = this.userRepository.create({
      username: dto.username,
      email: dto.email,
      passwordHash,
    });
    await this.userRepository.save(user);

    // Determine role: first user = admin
    const userCount = await this.userRepository.count();
    const roleName = userCount === 1 ? 'admin' : 'user';
    const role = await this.roleRepository.findOne({ where: { name: roleName } });

    if (!role) {
      throw new Error(`Role ${roleName} not found`);
    }

    await this.userRoleRepository.save({
      user,
      role,
    });

    // Generate tokens
    const { accessToken, expiresIn } = this.tokenService.generateTokens(user, [roleName]);
    const refreshToken = await this.refreshTokenService.createRefreshToken(user);

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        roles: [roleName],
        createdAt: user.createdAt.toISOString(),
      },
      accessToken,
      refreshToken,
    };
  }

  async login(dto: LoginRequest): Promise<LoginResponse> {
    const user = await this.userRepository.findByUsername(dto.username);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Account is disabled');
    }

    // Update last login
    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    // Get user roles
    const userWithRoles = await this.userRepository.findWithRoles(user.id);
    const roles = userWithRoles?.userRoles.map(ur => ur.role.name) || [];

    // Generate tokens
    const { accessToken, expiresIn } = this.tokenService.generateTokens(
      user,
      roles,
      dto.rememberMe,
    );
    const refreshToken = await this.refreshTokenService.createRefreshToken(
      user,
      dto.rememberMe,
    );

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        roles,
        createdAt: user.createdAt.toISOString(),
      },
      accessToken,
      refreshToken,
      expiresIn,
    };
  }

  async refreshToken(dto: RefreshTokenRequest): Promise<RefreshTokenResponse> {
    const user = await this.refreshTokenService.validateRefreshToken(dto.refreshToken);
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Revoke old token (rotation)
    await this.refreshTokenService.revokeRefreshToken(dto.refreshToken);

    // Get user roles
    const userWithRoles = await this.userRepository.findWithRoles(user.id);
    const roles = userWithRoles?.userRoles.map(ur => ur.role.name) || [];

    // Generate new tokens
    const { accessToken, expiresIn } = this.tokenService.generateTokens(user, roles);
    const newRefreshToken = await this.refreshTokenService.createRefreshToken(user);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn,
    };
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.refreshTokenService.revokeRefreshToken(refreshToken);
    }
  }

  async logoutAll(userId: string): Promise<void> {
    await this.refreshTokenService.revokeAllUserTokens(userId);
  }

  async getMe(userId: string) {
    const user = await this.userRepository.findWithRoles(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const roles = user.userRoles.map(ur => ur.role.name);

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      roles,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
```

**Step 1: Write service**
**Step 2: Write comprehensive tests**
**Step 3: Commit**
```bash
git add apps/api/src/auth/auth.service.ts
git add apps/api/src/auth/auth.service.spec.ts
git commit -m "feat(api): add auth service with register/login/refresh"
```

---

#### Task 3.7: Create Auth Controller
**Files:**
- Create: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/auth.controller.spec.ts`

**Implementation:**
```typescript
import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RegisterDto, LoginDto, RefreshTokenDto } from './dto';
import { Request } from 'express';

interface RequestWithUser extends Request {
  user: {
    userId: string;
    email: string;
    roles: string[];
  };
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: RequestWithUser,
    @Body('refreshToken') refreshToken?: string,
  ) {
    await this.authService.logout(req.user.userId, refreshToken);
    return { message: 'Logged out successfully' };
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAll(@Req() req: RequestWithUser) {
    await this.authService.logoutAll(req.user.userId);
    return { message: 'Logged out from all devices' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@Req() req: RequestWithUser) {
    return this.authService.getMe(req.user.userId);
  }
}
```

**Step 1: Write controller**
**Step 2: Write tests**
**Step 3: Commit**
```bash
git add apps/api/src/auth/auth.controller.ts
git commit -m "feat(api): add auth controller with endpoints"
```

---

#### Task 3.8: Update Auth Module
**Files:**
- Modify: `apps/api/src/auth/auth.module.ts`

**Implementation:**
```typescript
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { RefreshTokenService } from './refresh-token.service';
import { PasswordValidationService } from './password-validation.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_ACCESS_EXPIRY', '15m'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    RefreshTokenService,
    PasswordValidationService,
    JwtStrategy,
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
```

**Step 1: Update module**
**Step 2: Commit**
```bash
git add apps/api/src/auth/auth.module.ts
git commit -m "feat(api): update auth module with all providers"
```

---

#### Task 3.9: Update JWT Strategy
**Files:**
- Modify: `apps/api/src/auth/jwt.strategy.ts`

**Implementation:**
```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserRepository } from '../database/repositories/user.repository';

interface JwtPayload {
  sub: string;
  username: string;
  email: string;
  roles: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private userRepository: UserRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    return {
      userId: payload.sub,
      username: payload.username,
      email: payload.email,
      roles: payload.roles,
    };
  }
}
```

**Step 1: Update strategy**
**Step 2: Commit**
```bash
git add apps/api/src/auth/jwt.strategy.ts
git commit -m "feat(api): update JWT strategy to check user status"
```

---

### Phase 4: Backend User Management (Day 3)

#### Task 4.1: Create Users DTOs
**Files:**
- Create: `apps/api/src/users/dto/create-user.dto.ts`
- Create: `apps/api/src/users/dto/update-user.dto.ts`
- Create: `apps/api/src/users/dto/reset-password.dto.ts`
- Create: `apps/api/src/users/dto/index.ts`

**Implementation:**
```typescript
// create-user.dto.ts
import { createZodDto } from 'nestjs-zod';
import { CreateUserRequestSchema } from '@nexus/core';

export class CreateUserDto extends createZodDto(CreateUserRequestSchema) {}

// update-user.dto.ts
import { createZodDto } from 'nestjs-zod';
import { UpdateUserRequestSchema } from '@nexus/core';

export class UpdateUserDto extends createZodDto(UpdateUserRequestSchema) {}

// reset-password.dto.ts
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const ResetPasswordSchema = z.object({
  newPassword: z.string().min(8),
});

export class ResetPasswordDto extends createZodDto(ResetPasswordSchema) {}
```

**Step 1-4: Create DTOs**
**Step 5: Commit**
```bash
git add apps/api/src/users/dto/
git commit -m "feat(api): add user management DTOs"
```

---

#### Task 4.2: Create Users Service
**Files:**
- Create: `apps/api/src/users/users.service.ts`
- Create: `apps/api/src/users/users.service.spec.ts`

**Implementation:**
```typescript
import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserRepository } from '../database/repositories/user.repository';
import { RoleRepository } from '../database/repositories/role.repository';
import { UserRoleRepository } from '../database/repositories/user-role.repository';
import { PasswordValidationService } from '../auth/password-validation.service';
import { CreateUserRequest, UpdateUserRequest } from '@nexus/core';

@Injectable()
export class UsersService {
  constructor(
    private userRepository: UserRepository,
    private roleRepository: RoleRepository,
    private userRoleRepository: UserRoleRepository,
    private passwordValidationService: PasswordValidationService,
  ) {}

  async findAll(page: number = 1, limit: number = 20) {
    const [users, total] = await this.userRepository.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      relations: ['userRoles', 'userRoles.role'],
    });

    return {
      data: users.map(user => ({
        id: user.id,
        username: user.username,
        email: user.email,
        roles: user.userRoles.map(ur => ur.role.name),
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt?.toISOString(),
        createdAt: user.createdAt.toISOString(),
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const user = await this.userRepository.findWithRoles(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      roles: user.userRoles.map(ur => ur.role.name),
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt?.toISOString(),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  async create(dto: CreateUserRequest) {
    // Check username
    const existingUsername = await this.userRepository.findByUsername(dto.username);
    if (existingUsername) {
      throw new ConflictException('Username already exists');
    }

    // Check email
    const existingEmail = await this.userRepository.findByEmail(dto.email);
    if (existingEmail) {
      throw new ConflictException('Email already exists');
    }

    // Validate password
    const passwordCheck = this.passwordValidationService.validatePassword(dto.password);
    if (!passwordCheck.valid) {
      throw new ForbiddenException(passwordCheck.errors.join(', '));
    }

    // Create user
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = this.userRepository.create({
      username: dto.username,
      email: dto.email,
      passwordHash,
      isActive: dto.isActive ?? true,
    });
    await this.userRepository.save(user);

    // Assign role
    const role = await this.roleRepository.findOne({
      where: { name: dto.role || 'user' },
    });

    if (role) {
      await this.userRoleRepository.save({ user, role });
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      roles: [dto.role || 'user'],
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
    };
  }

  async update(id: string, dto: UpdateUserRequest) {
    const user = await this.userRepository.findWithRoles(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Update username if provided
    if (dto.username && dto.username !== user.username) {
      const existing = await this.userRepository.findByUsername(dto.username);
      if (existing) {
        throw new ConflictException('Username already exists');
      }
      user.username = dto.username;
    }

    // Update email if provided
    if (dto.email && dto.email !== user.email) {
      const existing = await this.userRepository.findByEmail(dto.email);
      if (existing) {
        throw new ConflictException('Email already exists');
      }
      user.email = dto.email;
    }

    // Update active status
    if (dto.isActive !== undefined) {
      user.isActive = dto.isActive;
    }

    await this.userRepository.save(user);

    // Update role if provided
    if (dto.role) {
      const newRole = await this.roleRepository.findOne({
        where: { name: dto.role },
      });

      if (newRole) {
        // Remove existing roles and add new one
        await this.userRoleRepository.delete({ user: { id: user.id } });
        await this.userRoleRepository.save({ user, role: newRole });
      }
    }

    return this.findOne(id);
  }

  async remove(id: string) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Soft delete - just disable
    user.isActive = false;
    await this.userRepository.save(user);
  }

  async resetPassword(id: string, newPassword: string) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const passwordCheck = this.passwordValidationService.validatePassword(newPassword);
    if (!passwordCheck.valid) {
      throw new ForbiddenException(passwordCheck.errors.join(', '));
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await this.userRepository.save(user);
  }
}
```

**Step 1: Write service**
**Step 2: Write tests**
**Step 3: Commit**
```bash
git add apps/api/src/users/users.service.ts
git commit -m "feat(api): add users service with CRUD operations"
```

---

#### Task 4.3: Create Users Controller
**Files:**
- Create: `apps/api/src/users/users.controller.ts`
- Create: `apps/api/src/users/users.controller.spec.ts`

**Implementation:**
```typescript
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateUserDto, UpdateUserDto, ResetPasswordDto } from './dto';
import { PaginationQuerySchema } from '@nexus/core';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @Roles('admin')
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pagination = PaginationQuerySchema.parse({
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    });

    return this.usersService.findAll(pagination.page, pagination.limit);
  }

  @Get(':id')
  @Roles('admin')
  async findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch(':id')
  @Roles('admin')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.usersService.remove(id);
  }

  @Post(':id/reset-password')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
  ) {
    await this.usersService.resetPassword(id, dto.newPassword);
    return { message: 'Password reset successfully' };
  }
}
```

**Step 1: Write controller**
**Step 2: Write tests**
**Step 3: Commit**
```bash
git add apps/api/src/users/users.controller.ts
git commit -m "feat(api): add users controller with admin-only endpoints"
```

---

#### Task 4.4: Create Users Module
**Files:**
- Create: `apps/api/src/users/users.module.ts`

**Implementation:**
```typescript
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

**Step 1: Create module**
**Step 2: Commit**
```bash
git add apps/api/src/users/users.module.ts
git commit -m "feat(api): add users module"
```

---

#### Task 4.5: Create Roles Controller
**Files:**
- Create: `apps/api/src/roles/roles.controller.ts`
- Create: `apps/api/src/roles/roles.service.ts`
- Create: `apps/api/src/roles/roles.module.ts`

**Implementation (Controller):**
```typescript
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { RolesService } from './roles.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('roles')
@UseGuards(JwtAuthGuard)
export class RolesController {
  constructor(private rolesService: RolesService) {}

  @Get()
  async findAll() {
    return this.rolesService.findAll();
  }

  @Get(':id/permissions')
  async getPermissions(@Param('id') id: string) {
    return this.rolesService.getPermissions(id);
  }
}
```

**Step 1-3: Create files**
**Step 4: Commit**
```bash
git add apps/api/src/roles/
git commit -m "feat(api): add roles controller and service"
```

---

### Phase 5: Frontend Auth Store (Day 3-4)

#### Task 5.1: Create Auth API Client
**Files:**
- Create: `apps/web/src/lib/api/auth.ts`

**Implementation:**
```typescript
import axios from 'axios';
import {
  RegisterRequest,
  RegisterResponse,
  LoginRequest,
  LoginResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
} from '@nexus/core';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

export const authApi = {
  register: async (data: RegisterRequest): Promise<RegisterResponse> => {
    const response = await axios.post(`${API_URL}/auth/register`, data);
    return response.data;
  },

  login: async (data: LoginRequest): Promise<LoginResponse> => {
    const response = await axios.post(`${API_URL}/auth/login`, data);
    return response.data;
  },

  refresh: async (refreshToken: string): Promise<RefreshTokenResponse> => {
    const response = await axios.post(`${API_URL}/auth/refresh`, {
      refreshToken,
    });
    return response.data;
  },

  logout: async (refreshToken?: string): Promise<void> => {
    await axios.post(
      `${API_URL}/auth/logout`,
      { refreshToken },
      {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
        },
      }
    );
  },

  logoutAll: async (): Promise<void> => {
    await axios.post(
      `${API_URL}/auth/logout-all`,
      {},
      {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
        },
      }
    );
  },

  getMe: async () => {
    const response = await axios.get(`${API_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
      },
    });
    return response.data;
  },
};
```

**Step 1: Create API client**
**Step 2: Commit**
```bash
git add apps/web/src/lib/api/auth.ts
git commit -m "feat(web): add auth API client"
```

---

#### Task 5.2: Create Auth Store (Zustand)
**Files:**
- Create: `apps/web/src/stores/auth.store.ts`
- Create: `apps/web/src/stores/auth.store.spec.ts`

**Implementation:**
```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  RegisterRequest,
  LoginRequest,
  RegisterResponse,
  LoginResponse,
} from '@nexus/core';
import { authApi } from '../lib/api/auth';

interface User {
  id: string;
  username: string;
  email: string;
  roles: string[];
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  register: (data: RegisterRequest) => Promise<void>;
  login: (data: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
  clearError: () => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      register: async (data: RegisterRequest) => {
        set({ isLoading: true, error: null });
        try {
          const response: RegisterResponse = await authApi.register(data);
          set({
            user: response.user,
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            isAuthenticated: true,
            isLoading: false,
          });
          localStorage.setItem('accessToken', response.accessToken);
          localStorage.setItem('refreshToken', response.refreshToken);
        } catch (error: any) {
          set({
            error: error.response?.data?.message || 'Registration failed',
            isLoading: false,
          });
          throw error;
        }
      },

      login: async (data: LoginRequest) => {
        set({ isLoading: true, error: null });
        try {
          const response: LoginResponse = await authApi.login(data);
          set({
            user: response.user,
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            isAuthenticated: true,
            isLoading: false,
          });
          localStorage.setItem('accessToken', response.accessToken);
          localStorage.setItem('refreshToken', response.refreshToken);
        } catch (error: any) {
          set({
            error: error.response?.data?.message || 'Login failed',
            isLoading: false,
          });
          throw error;
        }
      },

      logout: async () => {
        const { refreshToken } = get();
        try {
          await authApi.logout(refreshToken || undefined);
        } catch (error) {
          // Ignore logout errors
        }
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        });
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
      },

      logoutAll: async () => {
        try {
          await authApi.logoutAll();
        } catch (error) {
          // Ignore logout errors
        }
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        });
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
      },

      refreshToken: async () => {
        const { refreshToken } = get();
        if (!refreshToken) {
          set({ isAuthenticated: false });
          return false;
        }

        try {
          const response = await authApi.refresh(refreshToken);
          set({
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            isAuthenticated: true,
          });
          localStorage.setItem('accessToken', response.accessToken);
          localStorage.setItem('refreshToken', response.refreshToken);
          return true;
        } catch (error) {
          set({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
          });
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          return false;
        }
      },

      clearError: () => set({ error: null }),

      setTokens: (accessToken: string, refreshToken: string) => {
        set({
          accessToken,
          refreshToken,
          isAuthenticated: true,
        });
        localStorage.setItem('accessToken', accessToken);
        localStorage.setItem('refreshToken', refreshToken);
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
```

**Step 1: Write store**
**Step 2: Write tests**
**Step 3: Commit**
```bash
git add apps/web/src/stores/auth.store.ts
git commit -m "feat(web): add Zustand auth store"
```

---

#### Task 5.3: Update API Client with Interceptors
**Files:**
- Modify: `apps/web/src/lib/api/client.ts`

**Implementation:**
```typescript
import axios from 'axios';
import { useAuthStore } from '../../stores/auth.store';

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor to handle token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and not already retrying
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const { refreshToken } = useAuthStore.getState();
        if (!refreshToken) {
          throw new Error('No refresh token');
        }

        // Import authApi dynamically to avoid circular dependency
        const { authApi } = await import('./auth');
        const response = await authApi.refresh(refreshToken);

        useAuthStore.getState().setTokens(response.accessToken, response.refreshToken);

        // Retry original request with new token
        originalRequest.headers.Authorization = `Bearer ${response.accessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        // Refresh failed, logout
        useAuthStore.getState().logout();
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
```

**Step 1: Update client**
**Step 2: Commit**
```bash
git add apps/web/src/lib/api/client.ts
git commit -m "feat(web): add token refresh interceptor to API client"
```

---

#### Task 5.4: Create Auth Hooks
**Files:**
- Create: `apps/web/src/hooks/useAuth.ts`

**Implementation:**
```typescript
import { useCallback } from 'react';
import { useAuthStore } from '../stores/auth.store';
import {
  RegisterRequest,
  LoginRequest,
} from '@nexus/core';

export const useAuth = () => {
  const {
    user,
    isAuthenticated,
    isLoading,
    error,
    register,
    login,
    logout,
    logoutAll,
    clearError,
  } = useAuthStore();

  const handleRegister = useCallback(
    async (data: RegisterRequest) => {
      return register(data);
    },
    [register]
  );

  const handleLogin = useCallback(
    async (data: LoginRequest) => {
      return login(data);
    },
    [login]
  );

  const handleLogout = useCallback(async () => {
    return logout();
  }, [logout]);

  const hasRole = useCallback(
    (role: string) => {
      return user?.roles.includes(role) ?? false;
    },
    [user]
  );

  const isAdmin = useCallback(() => {
    return hasRole('admin');
  }, [hasRole]);

  return {
    user,
    isAuthenticated,
    isLoading,
    error,
    register: handleRegister,
    login: handleLogin,
    logout: handleLogout,
    logoutAll,
    clearError,
    hasRole,
    isAdmin,
  };
};
```

**Step 1: Create hook**
**Step 2: Commit**
```bash
git add apps/web/src/hooks/useAuth.ts
git commit -m "feat(web): add useAuth hook"
```

---

#### Task 5.5: Create Login Form Component
**Files:**
- Modify: `apps/web/src/pages/Login.tsx`

**Implementation:**
```typescript
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginRequestSchema } from '@nexus/core';
import type { LoginRequest } from '@nexus/core';
import { useAuth } from '../hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Workflow, Eye, EyeOff } from 'lucide-react';

export function Login() {
  const navigate = useNavigate();
  const { login, error, clearError, isLoading } = useAuth();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequestSchema),
    defaultValues: {
      rememberMe: false,
    },
  });

  const onSubmit = async (data: LoginRequest) => {
    try {
      await login(data);
      navigate('/');
    } catch (err) {
      // Error handled by store
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <Workflow className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-2xl">Nexus Orchestrator</CardTitle>
          <CardDescription>
            Sign in with your username and password
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
                {error}
              </div>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                placeholder="Enter your username"
                {...register('username')}
                onChange={(e) => {
                  register('username').onChange(e);
                  clearError();
                }}
              />
              {errors.username && (
                <p className="text-sm text-destructive">
                  {errors.username.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  {...register('password')}
                  onChange={(e) => {
                    register('password').onChange(e);
                    clearError();
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="text-sm text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox id="rememberMe" {...register('rememberMe')} />
              <Label htmlFor="rememberMe" className="text-sm font-normal">
                Remember me
              </Label>
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            <p>
              Don't have an account?{' '}
              <Link to="/register" className="text-primary hover:underline">
                Register
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 1: Rewrite Login component**
**Step 2: Commit**
```bash
git add apps/web/src/pages/Login.tsx
git commit -m "feat(web): rewrite login page with username/password form"
```

---

#### Task 5.6: Create Register Page
**Files:**
- Create: `apps/web/src/pages/Register.tsx`

**Implementation:**
```typescript
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { RegisterRequestSchema } from '@nexus/core';
import type { RegisterRequest } from '@nexus/core';
import { useAuth } from '../hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Workflow, Eye, EyeOff } from 'lucide-react';

export function Register() {
  const navigate = useNavigate();
  const { register: registerUser, error, clearError, isLoading } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterRequest & { confirmPassword: string }>({
    resolver: zodResolver(
      RegisterRequestSchema.extend({
        confirmPassword: z.string(),
      }).refine((data) => data.password === data.confirmPassword, {
        message: "Passwords don't match",
        path: ['confirmPassword'],
      })
    ),
  });

  const onSubmit = async (data: RegisterRequest) => {
    try {
      await registerUser(data);
      navigate('/');
    } catch (err) {
      // Error handled by store
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <Workflow className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-2xl">Create Account</CardTitle>
          <CardDescription>
            Register for Nexus Orchestrator
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                placeholder="Choose a username"
                {...register('username')}
                onChange={(e) => {
                  register('username').onChange(e);
                  clearError();
                }}
              />
              {errors.username && (
                <p className="text-sm text-destructive">
                  {errors.username.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                {...register('email')}
                onChange={(e) => {
                  register('email').onChange(e);
                  clearError();
                }}
              />
              {errors.email && (
                <p className="text-sm text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Create a password"
                  {...register('password')}
                  onChange={(e) => {
                    register('password').onChange(e);
                    clearError();
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="text-sm text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Confirm your password"
                  {...register('confirmPassword')}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="text-sm text-destructive">
                  {errors.confirmPassword.message}
                </p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Creating account...' : 'Create Account'}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            <p>
              Already have an account?{' '}
              <Link to="/login" className="text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 1: Create register page**
**Step 2: Commit**
```bash
git add apps/web/src/pages/Register.tsx
git commit -m "feat(web): add registration page"
```

---

#### Task 5.7: Create Protected Route Component
**Files:**
- Create: `apps/web/src/components/auth/ProtectedRoute.tsx`

**Implementation:**
```typescript
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRoles?: string[];
}

export function ProtectedRoute({ children, requiredRoles }: ProtectedRouteProps) {
  const { isAuthenticated, hasRole } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiredRoles && requiredRoles.length > 0) {
    const hasRequiredRole = requiredRoles.some((role) => hasRole(role));
    if (!hasRequiredRole) {
      return <Navigate to="/unauthorized" replace />;
    }
  }

  return <>{children}</>;
}
```

**Step 1: Create component**
**Step 2: Commit**
```bash
git add apps/web/src/components/auth/ProtectedRoute.tsx
git commit -m "feat(web): add protected route component"
```

---

### Phase 6: Frontend User Management (Day 4)

#### Task 6.1: Create Users API Client
**Files:**
- Create: `apps/web/src/lib/api/users.ts`

**Implementation:**
```typescript
import apiClient from './client';
import {
  CreateUserRequest,
  CreateUserResponse,
  UpdateUserRequest,
  PaginationResponse,
} from '@nexus/core';

interface User {
  id: string;
  username: string;
  email: string;
  roles: string[];
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
}

export const usersApi = {
  getUsers: async (
    page: number = 1,
    limit: number = 20
  ): Promise<PaginationResponse<User>> => {
    const response = await apiClient.get('/users', {
      params: { page, limit },
    });
    return response.data;
  },

  getUser: async (id: string): Promise<User> => {
    const response = await apiClient.get(`/users/${id}`);
    return response.data;
  },

  createUser: async (data: CreateUserRequest): Promise<CreateUserResponse> => {
    const response = await apiClient.post('/users', data);
    return response.data;
  },

  updateUser: async (id: string, data: UpdateUserRequest): Promise<User> => {
    const response = await apiClient.patch(`/users/${id}`, data);
    return response.data;
  },

  deleteUser: async (id: string): Promise<void> => {
    await apiClient.delete(`/users/${id}`);
  },

  resetPassword: async (id: string, newPassword: string): Promise<void> => {
    await apiClient.post(`/users/${id}/reset-password`, { newPassword });
  },
};
```

**Step 1: Create API client**
**Step 2: Commit**
```bash
git add apps/web/src/lib/api/users.ts
git commit -m "feat(web): add users API client"
```

---

#### Task 6.2: Create Users Management Page
**Files:**
- Create: `apps/web/src/pages/Users.tsx`

**Implementation:** (Simplified - full table with CRUD)
```typescript
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../lib/api/users';
import { useAuth } from '../hooks/useAuth';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ProtectedRoute } from '../components/auth/ProtectedRoute';

export function Users() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ['users', page],
    queryFn: () => usersApi.getUsers(page),
    enabled: isAdmin(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => usersApi.deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  if (!isAdmin()) {
    return <div>Access denied</div>;
  }

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error loading users</div>;

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">User Management</h1>
        <Button>Create User</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Username</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.data.map((user) => (
            <TableRow key={user.id}>
              <TableCell>{user.username}</TableCell>
              <TableCell>{user.email}</TableCell>
              <TableCell>
                <Badge variant={user.roles.includes('admin') ? 'default' : 'secondary'}>
                  {user.roles.join(', ')}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={user.isActive ? 'default' : 'destructive'}>
                  {user.isActive ? 'Active' : 'Disabled'}
                </Badge>
              </TableCell>
              <TableCell>
                {new Date(user.createdAt).toLocaleDateString()}
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="sm">
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteMutation.mutate(user.id)}
                  disabled={deleteMutation.isPending}
                >
                  Disable
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

**Step 1: Create page**
**Step 2: Commit**
```bash
git add apps/web/src/pages/Users.tsx
git commit -m "feat(web): add user management page"
```

---

#### Task 6.3: Update App.tsx Routes
**Files:**
- Modify: `apps/web/src/App.tsx`

**Add routes:**
```typescript
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Users } from './pages/Users';

// In router config:
<Route path="/login" element={<Login />} />
<Route path="/register" element={<Register />} />
<Route
  path="/users"
  element={
    <ProtectedRoute requiredRoles={['admin']}>
      <Users />
    </ProtectedRoute>
  }
/>
```

**Step 1: Update routes**
**Step 2: Commit**
```bash
git add apps/web/src/App.tsx
git commit -m "feat(web): add auth routes and protected user management"
```

---

### Phase 7: Configuration & Environment (Day 4-5)

#### Task 7.1: Create Environment Configuration Template
**Files:**
- Create: `.env.example`

**Implementation:**
```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=nexus
DB_PASSWORD=nexus
DB_DATABASE=nexus

# JWT Configuration
JWT_SECRET=your-super-secret-key-change-in-production-min-32-chars
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
JWT_REFRESH_REMEMBER_ME=30d

# Password Policy
PASSWORD_MIN_LENGTH=8
PASSWORD_REQUIRE_UPPERCASE=true
PASSWORD_REQUIRE_LOWERCASE=true
PASSWORD_REQUIRE_NUMBERS=true
PASSWORD_REQUIRE_SPECIAL=true
PASSWORD_BCRYPT_ROUNDS=12

# Rate Limiting
AUTH_RATE_LIMIT_WINDOW=900000
AUTH_RATE_LIMIT_MAX=5

# API
API_PORT=3000
API_PREFIX=/api/v1
```

**Step 1: Create env template**
**Step 2: Commit**
```bash
git add .env.example
git commit -m "docs: add environment configuration template"
```

---

#### Task 7.2: Update Config Validation
**Files:**
- Modify: `apps/api/src/config/` (create if doesn't exist)

**Create validation schema:**
```typescript
import { z } from 'zod';

export const configValidationSchema = z.object({
  // Database
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),
  DB_USERNAME: z.string(),
  DB_PASSWORD: z.string(),
  DB_DATABASE: z.string(),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  JWT_REFRESH_REMEMBER_ME: z.string().default('30d'),

  // Password Policy
  PASSWORD_MIN_LENGTH: z.coerce.number().default(8),
  PASSWORD_REQUIRE_UPPERCASE: z.coerce.boolean().default(true),
  PASSWORD_REQUIRE_LOWERCASE: z.coerce.boolean().default(true),
  PASSWORD_REQUIRE_NUMBERS: z.coerce.boolean().default(true),
  PASSWORD_REQUIRE_SPECIAL: z.coerce.boolean().default(true),
  PASSWORD_BCRYPT_ROUNDS: z.coerce.number().default(12),

  // Rate Limiting
  AUTH_RATE_LIMIT_WINDOW: z.coerce.number().default(900000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(5),

  // API
  PORT: z.coerce.number().default(3000),
  API_PREFIX: z.string().default('/api/v1'),
});
```

**Step 1: Create validation schema**
**Step 2: Commit**
```bash
git add apps/api/src/config/
git commit -m "feat(api): add environment configuration validation"
```

---

### Phase 8: Testing & Documentation (Day 5)

#### Task 8.1: Write Backend Unit Tests
**Files:**
- Create/Update: `apps/api/src/auth/*.spec.ts`
- Create/Update: `apps/api/src/users/*.spec.ts`

**Test Coverage Requirements:**
- [ ] Auth Service: register, login, refresh, logout (100%)
- [ ] Token Service: generate, verify (100%)
- [ ] Refresh Token Service: create, validate, revoke (100%)
- [ ] Password Validation: all validation rules (100%)
- [ ] Users Service: CRUD operations (100%)
- [ ] Guards: JWT, Roles (100%)

**Step 1: Write auth service tests**
**Step 2: Write token service tests**
**Step 3: Write users service tests**
**Step 4: Commit**
```bash
git add apps/api/src/**/*.spec.ts
git commit -m "test(api): add auth and user service tests"
```

---

#### Task 8.2: Write Frontend Tests
**Files:**
- Create/Update: `apps/web/src/stores/*.spec.ts`
- Create/Update: `apps/web/src/hooks/*.spec.ts`

**Test Coverage Requirements:**
- [ ] Auth Store: login, logout, token refresh
- [ ] useAuth Hook: all methods
- [ ] ProtectedRoute component

**Step 1: Write store tests**
**Step 2: Write hook tests**
**Step 3: Commit**
```bash
git add apps/web/src/**/*.spec.ts
git commit -m "test(web): add auth store and hook tests"
```

---

#### Task 8.3: Write E2E Tests
**Files:**
- Create: `apps/web/e2e/auth.spec.ts`

**Test Scenarios:**
- [ ] User registration
- [ ] User login with valid credentials
- [ ] User login with invalid credentials
- [ ] Token refresh on expiry
- [ ] Logout functionality
- [ ] Protected route access
- [ ] Remember me functionality

**Step 1: Write E2E tests**
**Step 2: Commit**
```bash
git add apps/web/e2e/auth.spec.ts
git commit -m "test(web): add auth E2E tests"
```

---

#### Task 8.4: Create API Documentation
**Files:**
- Create: `docs/api/auth-api.md`
- Create: `docs/api/users-api.md`

**Documentation:**
- All endpoints with examples
- Request/response schemas
- Error codes
- Authentication flows

**Step 1: Write auth API docs**
**Step 2: Write users API docs**
**Step 3: Commit**
```bash
git add docs/api/
git commit -m "docs: add API documentation for auth and users"
```

---

## 8. Dependencies

### Backend
```json
{
  "dependencies": {
    "bcrypt": "^5.x",
    "nestjs-zod": "^3.x"
  },
  "devDependencies": {
    "@types/bcrypt": "^5.x"
  }
}
```

### Frontend
```json
{
  "dependencies": {
    "@hookform/resolvers": "^3.x",
    "zod": "^3.x"
  }
}
```

### Shared
```json
{
  "dependencies": {
    "zod": "^3.x"
  }
}
```

---

## 9. Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| JWT secret exposure | Low | High | Use environment variables, validate min length |
| Token theft | Medium | High | Short expiry, refresh rotation, secure storage |
| Password brute force | Medium | High | Rate limiting, bcrypt with sufficient rounds |
| XSS attacks | Medium | High | HttpOnly cookies (future), input validation |
| Database migration issues | Low | Medium | Test migrations, backup before deploy |

---

## 10. Migration Plan

### From Current State (Manual JWT)
1. Deploy database migrations (new tables)
2. Run role seeds
3. Existing JWT tokens in localStorage will fail validation (no user in DB)
4. Users must re-register via new registration flow
5. First registered user becomes admin
6. Admin creates additional users

### Rollback Plan
1. Keep existing auth module files versioned
2. Database rollback: Drop new tables if needed
3. Frontend fallback: Could temporarily support both auth methods

---

## 11. Future Enhancements (Post-MVP)

- [ ] MFA/TOTP support
- [ ] Password reset via email
- [ ] OAuth2 integration (Google, GitHub)
- [ ] Session management UI (view active sessions)
- [ ] Audit logging for auth events
- [ ] Granular permissions system
- [ ] User groups/teams
- [ ] API key management

---

## Approval

**Epic approved by:** _________________

**Date:** _________________

**Ready for implementation:** ☐ Yes  ☐ No (requires revisions)

**Notes:**
