import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { QuoteStatus } from '../quote.types.js';

export class ApproveDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class RejectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}

const STATUSES: QuoteStatus[] = [
  'pending_specialist',
  'pending_approver',
  'approved',
  'rejected',
  'duplicate',
];

export class ListQuotesQueryDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: QuoteStatus;

  @IsOptional()
  @IsString()
  approver_id?: string;
}
