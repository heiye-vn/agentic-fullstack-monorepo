import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { RequirementService } from './llm/requirement.service.js';
import { APP_NAME, type RequirementResult } from '@autix/contracts';
import { vi } from 'vitest';

describe('AppController', () => {
  let appController: AppController;
  let requirementService: RequirementService;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: RequirementService,
          useValue: {
            extract: vi.fn(),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
    requirementService = app.get<RequirementService>(RequirementService);
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

  describe('requirement/extract', () => {
    it('should call requirementService.extract and return RequirementResult', async () => {
      const mockResult: RequirementResult = {
        action: '用户注册',
        constraints: ['必须绑定手机号', '密码至少8位'],
        entities: ['用户', '手机号', '密码'],
      };

      const extractSpy = vi
        .spyOn(requirementService, 'extract')
        .mockResolvedValue(mockResult);

      const res = await appController.extractRequirement({
        input: '用户注册时必须绑定手机号，密码至少8位',
      });

      expect(extractSpy).toHaveBeenCalledWith(
        '用户注册时必须绑定手机号，密码至少8位',
      );
      expect(res).toEqual(mockResult);
    });
  });
});
