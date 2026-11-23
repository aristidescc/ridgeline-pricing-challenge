import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { createValidationPipe } from './common/validation.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();
  const port = app.get(ConfigService).getOrThrow<number>('port');
  await app.listen(port);
  new Logger('Bootstrap').log(
    `Ridgeline quote approvals listening on :${port}`,
  );
}
await bootstrap();
