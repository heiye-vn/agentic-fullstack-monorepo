import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { APP_NAME } from '@autix/contracts';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should return ok: true', () => {
      expect(appController.getHealth()).toEqual({ ok: true });
    });
  });

  describe('hello', () => {
    it('should return hello message with APP_NAME', () => {
      expect(appController.getHello()).toEqual({
        message: `Hello from Chat, shared APP_NAME=${APP_NAME}`,
      });
    });
  });
});
