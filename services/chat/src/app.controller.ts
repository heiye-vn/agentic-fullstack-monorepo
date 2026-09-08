import { Body, Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service.js';
import { RequirementService } from './llm/requirement.service.js';
import type { RequirementResult } from '@autix/contracts';

export interface ExtractRequirementDto {
  input: string;
}

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly requirementService: RequirementService,
  ) {}

  @Get('health')
  getHealth(): { ok: boolean } {
    return this.appService.getHealth();
  }

  @Get('hello')
  getHello(): { message: string } {
    return this.appService.getHello();
  }

  @Post('requirement/extract')
  async extractRequirement(
    @Body() body: ExtractRequirementDto,
  ): Promise<RequirementResult> {
    return this.requirementService.extract(body?.input);
  }
}
