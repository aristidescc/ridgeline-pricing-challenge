import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from './audit/audit.module.js';
import { CommonModule } from './common/common.module.js';
import configuration from './config/configuration.js';
import { DatabaseModule } from './database/database.module.js';
import { QuotesModule } from './quotes/quotes.module.js';
import { ReportingModule } from './reporting/reporting.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ReportingModule,
    CommonModule,
    DatabaseModule,
    AuditModule,
    QuotesModule,
  ],
})
export class AppModule {}
