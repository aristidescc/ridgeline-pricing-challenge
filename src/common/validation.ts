import { ValidationPipe } from '@nestjs/common';

/** Global validation: strip unknown fields, reject them loudly, coerce to DTO classes. */
export const createValidationPipe = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
