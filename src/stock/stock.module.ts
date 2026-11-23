import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import {
  FixtureStockClient,
  HttpStockClient,
  StockClient,
} from './stock.client.js';

@Module({
  providers: [
    {
      provide: StockClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StockClient => {
        const s = config.getOrThrow<AppConfig['stock']>('stock');
        return s.client === 'fixture'
          ? new FixtureStockClient(s.fixturePath)
          : new HttpStockClient(s.baseUrl, {
              attempts: s.maxAttempts,
              timeoutMs: s.timeoutMs,
              baseDelayMs: s.baseDelayMs,
            });
      },
    },
  ],
  exports: [StockClient],
})
export class StockModule {}
