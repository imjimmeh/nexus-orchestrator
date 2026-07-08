import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  ATTACHMENT_MAX_SIZE_BYTES,
  type AttachmentDto,
  type AttachmentOwnerType,
} from '@nexus/core';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import {
  AttachmentsService,
  type UploadedFile as AttachmentFile,
} from './attachments.service';
import type { Attachment } from './database/entities/attachment.entity';
import {
  ATTACHMENTS_CONFIG,
  type AttachmentsConfig,
} from './config/attachments.config';

interface AuthenticatedRequest extends Request {
  user?: {
    userId?: string;
  };
}

interface LinkAttachmentBody {
  ownerType: AttachmentOwnerType;
  ownerId: string;
}

@ApiTags('attachments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('attachments')
export class AttachmentsController {
  constructor(
    private readonly attachments: AttachmentsService,
    private readonly configService: ConfigService,
  ) {}

  private assertAttachmentsEnabled(): void {
    const config =
      this.configService.get<AttachmentsConfig>(ATTACHMENTS_CONFIG);
    if (!config?.enabled) {
      throw new ForbiddenException('File attachments are not enabled');
    }
  }

  private toDto(attachment: Attachment): AttachmentDto {
    return {
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mime_type,
      sizeBytes: attachment.size_bytes,
      parseStatus: attachment.parse_status,
      parseError: attachment.parse_error ?? null,
      createdAt: attachment.created_at.toISOString(),
    };
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: ATTACHMENT_MAX_SIZE_BYTES },
    }),
  )
  async upload(
    @UploadedFile() file: AttachmentFile,
    @Req() req: AuthenticatedRequest,
  ) {
    this.assertAttachmentsEnabled();
    if (!file) throw new BadRequestException('No file provided');
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedException();
    const data = await this.attachments.upload(file, userId);
    return { success: true, data };
  }

  @Get()
  async listForOwner(
    @Query('ownerType') ownerType: AttachmentOwnerType,
    @Query('ownerId') ownerId: string,
  ) {
    this.assertAttachmentsEnabled();
    if (!ownerType || !ownerId) {
      throw new BadRequestException(
        'ownerType and ownerId query params are required',
      );
    }
    const attachments = await this.attachments.listForOwner(ownerType, ownerId);
    const data = attachments.map((a) => this.toDto(a));
    return { success: true, data };
  }

  @Post(':id/link')
  async linkAttachment(
    @Param('id') id: string,
    @Body() body: LinkAttachmentBody,
  ) {
    this.assertAttachmentsEnabled();
    if (!body.ownerType || !body.ownerId) {
      throw new BadRequestException('ownerType and ownerId are required');
    }
    await this.attachments.link(id, body.ownerType, body.ownerId);
    return { success: true, data: null };
  }

  @Get(':id')
  async getMetadata(@Param('id') id: string) {
    const attachment = await this.attachments.getMetadata(id);
    return { success: true, data: this.toDto(attachment) };
  }

  @Get(':id/content')
  async getContent(@Param('id') id: string, @Res() res: Response) {
    const { body, contentType } = await this.attachments.getContent(id);
    res.setHeader('Content-Type', contentType);
    res.send(body);
  }

  @Get(':id/parsed')
  async getParsed(@Param('id') id: string) {
    const data = await this.attachments.getParsed(id);
    return { success: true, data };
  }
}
