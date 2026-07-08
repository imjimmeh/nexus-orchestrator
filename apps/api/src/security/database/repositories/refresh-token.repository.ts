import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../entities/refresh-token.entity';

@Injectable()
export class RefreshTokenRepository extends Repository<RefreshToken> {
  constructor(private dataSource: DataSource) {
    super(RefreshToken, dataSource.createEntityManager());
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.findOne({
      where: { tokenHash, isRevoked: false },
      relations: { user: true },
    });
  }

  async findActiveByUserId(userId: string): Promise<RefreshToken[]> {
    return this.find({
      where: {
        user: { id: userId },
        isRevoked: false,
      },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.update(
      { user: { id: userId }, isRevoked: false },
      { isRevoked: true },
    );
  }
}
