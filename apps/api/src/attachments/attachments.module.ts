import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { attachmentsConfig } from './config/attachments.config';
import { ATTACHMENT_PARSE_QUEUE } from './parsing/attachment-parse.types';
import { AttachmentsService } from './attachments.service';
import { AttachmentsController } from './attachments.controller';
import { GarageObjectStorageService } from './storage/garage-object-storage.service';
import { OBJECT_STORAGE } from './storage/object-storage.interface';
import { AttachmentParseProcessor } from './parsing/attachment-parse.processor';
import { DocumentParserService } from './parsing/document-parser.service';
import { ImageDescriberService } from './parsing/image-describer.service';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [
    ConfigModule.forFeature(attachmentsConfig),
    BullModule.registerQueue({ name: ATTACHMENT_PARSE_QUEUE }),
    AuthModule,
    AuthorizationModule,
    DatabaseModule,
  ],
  controllers: [AttachmentsController],
  providers: [
    AttachmentsService,
    { provide: OBJECT_STORAGE, useClass: GarageObjectStorageService },
    AttachmentParseProcessor,
    DocumentParserService,
    ImageDescriberService,
  ],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
