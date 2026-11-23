import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APPROVAL_RULES, loadApprovalRules } from '../config/approval-rules.js';
import { ReportingRepository } from '../reporting/reporting.repository.js';
import { AuthGuard } from './auth.guard.js';
import { Clock, FixedClock, SystemClock } from './clock.js';
import { UsersDirectory } from './users.directory.js';

@Global()
@Module({
  providers: [
    {
      provide: Clock,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Clock => {
        const asOf = config.get<string>('asOf');
        return asOf ? new FixedClock(new Date(asOf)) : new SystemClock();
      },
    },
    {
      // Fails fast at boot if config/approval-rules.json is invalid.
      provide: APPROVAL_RULES,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        loadApprovalRules(config.getOrThrow<string>('rulesPath')),
    },
    {
      provide: UsersDirectory,
      inject: [ConfigService, ReportingRepository],
      useFactory: (config: ConfigService, reporting: ReportingRepository) =>
        UsersDirectory.from(
          reporting.approvers,
          config.getOrThrow<string>('serviceUsersPath'),
        ),
    },
    AuthGuard,
  ],
  exports: [Clock, APPROVAL_RULES, UsersDirectory, AuthGuard],
})
export class CommonModule {}
