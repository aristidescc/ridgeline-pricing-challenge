import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReportingRepository } from './reporting.repository.js';

@Global()
@Module({
  providers: [
    {
      provide: ReportingRepository,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        ReportingRepository.fromDir(
          config.getOrThrow<string>('reportingDbDir'),
        ),
    },
  ],
  exports: [ReportingRepository],
})
export class ReportingModule {}
