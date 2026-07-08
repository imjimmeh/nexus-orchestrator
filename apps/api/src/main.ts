import { otelSDK } from './observability/tracing';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WinstonModule } from 'nest-winston';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import {
  getApiLogLevel,
  getNestLoggerLevels,
  loggerConfig,
} from './common/logger.config';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe';

const apiLogLevel = getApiLogLevel(process.env);
Logger.overrideLogger(getNestLoggerLevels(apiLogLevel));
const bootstrapLogger = new Logger('Bootstrap');

async function bootstrap() {
  bootstrapLogger.debug('Bootstrap starting...');
  // Start OTel SDK
  bootstrapLogger.debug('Starting OTel SDK...');
  await otelSDK.start();
  bootstrapLogger.debug('OTel SDK started');

  bootstrapLogger.debug('Creating Nest application...');
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger(loggerConfig),
    // Capture the raw request body (Buffer) so the integration PR webhook can
    // verify the GitHub HMAC signature over the exact received bytes. The parsed
    // JSON body remains available; this only annotates `request.rawBody`.
    rawBody: true,
  });
  bootstrapLogger.debug('Nest application created');

  // Set global API prefix
  app.setGlobalPrefix('api');
  bootstrapLogger.debug('Global prefix set');

  const config = new DocumentBuilder()
    .setTitle('Nexus Core Engine API')
    .setDescription('AI orchestration platform API')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'x-api-key')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
  bootstrapLogger.debug('Swagger setup complete');

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
    new ZodValidationPipe(),
  );
  bootstrapLogger.debug('Global pipes setup');

  // Configure CORS
  const corsOrigin = process.env.CORS_ORIGIN;
  if (corsOrigin) {
    app.enableCors({
      origin:
        corsOrigin === '*' ? true : corsOrigin.split(',').map((o) => o.trim()),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-API-Key',
        'X-Request-ID',
        'X-Correlation-ID',
        'X-Causation-ID',
      ],
      exposedHeaders: ['X-Request-ID', 'X-Correlation-ID', 'X-Causation-ID'],
    });
    bootstrapLogger.debug(`CORS enabled for origin(s): ${corsOrigin}`);
  } else {
    app.enableCors({
      origin: false,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-API-Key',
        'X-Request-ID',
        'X-Correlation-ID',
        'X-Causation-ID',
      ],
      exposedHeaders: ['X-Request-ID', 'X-Correlation-ID', 'X-Causation-ID'],
    });
    bootstrapLogger.debug('CORS disabled: CORS_ORIGIN is not set');
  }

  const port = (process.env.PORT as string) || '3000';
  bootstrapLogger.debug(`Attempting to listen on port ${port}...`);
  app.enableShutdownHooks();
  bootstrapLogger.debug('Shutdown hooks enabled');
  await app.listen(port);
  bootstrapLogger.log(`Application is running on: http://localhost:${port}`);
}

bootstrap().catch((err: unknown) => {
  bootstrapLogger.error(
    'Error during bootstrap',
    err instanceof Error ? err.stack : String(err),
  );
  process.exit(1);
});
