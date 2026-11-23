import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { Draft, DraftLine } from '../../common/domain.types.js';

export class DraftLineDto implements DraftLine {
  @IsInt()
  @Min(1)
  line: number;

  @IsString()
  @IsNotEmpty()
  part_number: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @IsPositive()
  quantity: number;

  @IsString()
  @IsNotEmpty()
  unit: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  extraction_confidence: number;
}

/** Draft quote contract from the extraction (Intake) service — matches draft_quotes.json. */
export class CreateDraftDto implements Draft {
  @IsString()
  @IsNotEmpty()
  draft_id: string;

  @IsString()
  @IsNotEmpty()
  rfq_id: string;

  @IsString()
  @IsNotEmpty()
  customer_id: string;

  @IsISO8601({ strict: true })
  created_at: string;

  @IsOptional()
  @IsString()
  prepared_by?: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  proposed_discount_pct: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => DraftLineDto)
  lines: DraftLineDto[];

  @IsOptional()
  @IsString()
  note?: string;
}
