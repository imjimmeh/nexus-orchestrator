import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Invitation } from '../entities/invitation.entity';
import { InvitationStatus } from '../../invitation.status.types';

@Injectable()
export class InvitationRepository extends Repository<Invitation> {
  constructor(private dataSource: DataSource) {
    super(Invitation, dataSource.createEntityManager());
  }

  async findPendingAtNode(scopeNodeId: string): Promise<Invitation[]> {
    return this.find({
      where: { scopeNodeId, status: InvitationStatus.Pending },
      order: { createdAt: 'DESC' },
    });
  }
}
