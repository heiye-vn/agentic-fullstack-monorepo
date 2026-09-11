import { TaskStatus } from '../../prisma/index.js';

/**
 * 触发任务事件输入参数接口
 */
export interface EmitTaskEventInput {
  /** 业务任务 ID (例如 documentId) */
  taskId: string;
  /** 任务类型 (例如 'document_process') */
  taskType: string;
  /** 任务状态 (pending | processing | done | error) */
  status: TaskStatus;
  /** 可读描述消息 */
  message?: string;
  /** 附加元数据 (JSON 格式) */
  metadata?: Record<string, any>;
}

/**
 * 任务历史分页查询参数
 */
export interface TaskHistoryQueryDto {
  /** 当前页码，默认 1 */
  page?: number;
  /** 每页条数，默认 10 */
  pageSize?: number;
  /** 任务类型过滤 */
  taskType?: string;
  /** 任务状态过滤 */
  status?: TaskStatus;
}
