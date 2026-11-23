import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, Roles } from '../common/auth.guard.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import type { User } from '../common/users.directory.js';
import { CreateDraftDto } from './dto/create-draft.dto.js';
import {
  ApproveDto,
  ListQuotesQueryDto,
  RejectDto,
} from './dto/decision.dto.js';
import { toQuoteView } from './quote.view.js';
import { QuotesService } from './quotes.service.js';

@Controller('quotes')
@UseGuards(AuthGuard)
export class QuotesController {
  constructor(@Inject(QuotesService) private readonly quotes: QuotesService) {}

  /** Intake: the extraction service submits a draft; 201 new, 200 replay of a known draft_id. */
  @Post()
  @Roles(['intake_service'])
  async create(
    @Body() dto: CreateDraftDto,
    @CurrentUser() user: User,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { created, quote } = await this.quotes.intake(dto, user);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return toQuoteView(quote);
  }

  @Get()
  list(@Query() q: ListQuotesQueryDto) {
    return this.quotes
      .list({ status: q.status, approverId: q.approver_id })
      .map(toQuoteView);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return toQuoteView(this.quotes.get(id));
  }

  @Get(':id/audit')
  audit(@Param('id') id: string) {
    return this.quotes.history(id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveDto,
    @CurrentUser() user: User,
  ) {
    return toQuoteView(this.quotes.approve(id, user, dto.comment));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id') id: string,
    @Body() dto: RejectDto,
    @CurrentUser() user: User,
  ) {
    return toQuoteView(this.quotes.reject(id, user, dto.reason));
  }

  /** STUB: returns 501 — see QuotesService.edit for the reprice → reroute design. */
  @Patch(':id')
  edit(@Param('id') id: string) {
    return this.quotes.edit(id);
  }
}
