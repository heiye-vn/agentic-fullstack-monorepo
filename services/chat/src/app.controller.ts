import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  getHealth(): { ok: boolean } {
    return this.appService.getHealth();
  }

  @Get('hello')
  getHello(): { message: string } {
    return this.appService.getHello();
  }
}
