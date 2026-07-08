import { describe, expect, it, vi } from 'vitest';
import { UserRepository } from './user.repository';

describe('UserRepository', () => {
  it('finds active admins using the seeded lowercase role name', async () => {
    const repository = Object.create(
      UserRepository.prototype,
    ) as UserRepository;
    const find = vi.fn().mockResolvedValue([]);
    repository.find = find;

    await repository.findActiveAdmins();

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          userRoles: {
            role: {
              name: 'admin',
            },
          },
        }),
      }),
    );
  });
});
