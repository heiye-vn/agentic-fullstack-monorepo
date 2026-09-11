import {
  Body,
  Controller,
  Post,
  UseGuards,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { SearchService } from './search.service.js';

export interface SearchRequestDto {
  query: string;
  topK?: number;
}

@Controller('api/search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /**
   * 语义相似度搜索
   * POST /api/search
   * Headers: Authorization: Bearer <token>
   * Body: { "query": "搜索词", "topK": 4 }
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async search(
    @CurrentUser('userId') userId: string,
    @Body() body: SearchRequestDto,
  ) {
    if (!body || typeof body.query !== 'string' || body.query.trim() === '') {
      throw new BadRequestException('query 检索词不能为空且必须为非空字符串');
    }

    const topK =
      typeof body.topK === 'number' && !Number.isNaN(body.topK) ? body.topK : 4;

    const results = await this.searchService.similaritySearch(
      body.query.trim(),
      userId,
      topK,
    );

    return {
      query: body.query.trim(),
      topK,
      total: results.length,
      results,
    };
  }
}
