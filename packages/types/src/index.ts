/**
 * 全局统一 API 响应信封结构接口
 */
export interface ApiResponse<T = any> {
  /** 业务执行状态：true 成功，false 失败 */
  success: boolean;
  /** 响应业务码或 HTTP 状态码字符串，例如 '200', '400', '404', '500' */
  code: string | number;
  /** 提示消息或错误描述 */
  msg: string;
  /** 全链路追踪 ID */
  traceId: string;
  /** 响应业务数据实体 */
  data: T;
}
