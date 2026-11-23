import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { StockModule } from '../stock/stock.module.js';
import { QuotesController } from './quotes.controller.js';
import { QuotesRepository } from './quotes.repository.js';
import { QuotesService } from './quotes.service.js';

@Module({
  imports: [AuditModule, StockModule],
  controllers: [QuotesController],
  providers: [QuotesService, QuotesRepository],
  exports: [QuotesService],
})
export class QuotesModule {}
