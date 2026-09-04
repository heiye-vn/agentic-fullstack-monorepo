import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditStatus } from '@prisma/client';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const method = req.method;

    // 仅针对非 GET 的写操作记录审计日志 (POST, PUT, PATCH, DELETE)
    if (['GET', 'OPTIONS', 'HEAD'].includes(method)) {
      return next.handle();
    }

    const path = req.originalUrl || req.url;
    // 忽略健康检查与 auth 本身的常规日志 (auth 内部已专门记录 LoginLog)
    if (path.includes('/health') || path.includes('/api/v1/auth/login')) {
      return next.handle();
    }

    const startTime = Date.now();
    const moduleName = this.extractModule(path);
    const sanitizedParams = this.sanitizeBody(req.body);

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const user = req.user;
          this.writeLog({
            userId: user?.userId,
            username: user?.username || 'ANONYMOUS',
            module: moduleName,
            action: `${method} ${path}`,
            method,
            path,
            params: sanitizedParams,
            status: AuditStatus.SUCCESS,
            duration,
          });
        },
        error: (err) => {
          const duration = Date.now() - startTime;
          const user = req.user;
          this.writeLog({
            userId: user?.userId,
            username: user?.username || 'ANONYMOUS',
            module: moduleName,
            action: `${method} ${path}`,
            method,
            path,
            params: sanitizedParams,
            status: AuditStatus.FAIL,
            duration,
            errorMessage: err?.message ? String(err.message).slice(0, 500) : 'Unknown Error',
          });
        },
      }),
    );
  }

  /**
   * 异步写入审计数据库
   */
  private writeLog(data: any) {
    this.prisma.operationLog
      .create({ data })
      .catch((err) => {
        this.logger.error('Failed to write operation audit log:', err);
      });
  }

  /**
   * 从 URL 提取所属模块标识
   */
  private extractModule(path: string): string {
    if (path.includes('/users')) return '用户管理';
    if (path.includes('/roles')) return '角色管理';
    if (path.includes('/permissions')) return '权限管理';
    if (path.includes('/departments')) return '部门管理';
    if (path.includes('/auth')) return '认证安全';
    return '系统核心';
  }

  /**
   * 深度参数敏感信息脱敏
   */
  private sanitizeBody(body: any): string {
    if (!body || typeof body !== 'object') return '';

    try {
      const copy = JSON.parse(JSON.stringify(body));
      const sensitiveKeys = ['password', 'newpassword', 'token', 'refreshtoken', 'secret'];

      const redact = (obj: any) => {
        for (const key of Object.keys(obj)) {
          if (sensitiveKeys.includes(key.toLowerCase())) {
            obj[key] = '******';
          } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            redact(obj[key]);
          }
        }
      };

      redact(copy);
      return JSON.stringify(copy).slice(0, 2000); // 截断防止溢出
    } catch {
      return '[Parsing Failed]';
    }
  }
}
