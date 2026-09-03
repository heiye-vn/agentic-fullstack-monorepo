import { Injectable } from '@nestjs/common';
import { APP_NAME } from '@autix/contracts';

@Injectable()
export class AppService {
  getHealth(): { ok: boolean } {
    return { ok: true };
  }

  getHello(): { message: string } {
    return {
      message: `Hello from Chat, shared APP_NAME=${APP_NAME}`,
    };
  }
}
