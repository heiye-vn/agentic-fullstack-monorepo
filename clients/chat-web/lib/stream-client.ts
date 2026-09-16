export interface GraphStreamEvent {
  type: "node_start" | "node_end" | "token" | "error";
  node?: string;
  step?: number;
  totalSteps?: number;
  status?: "started" | "completed";
  parallel?: boolean;
  displayName?: string;
  token?: string;
  content?: string;
  error?: string;
}

export interface StreamGraphOptions {
  apiBaseUrl: string;
  input: string;
  signal?: AbortSignal;
  onEvent: (event: GraphStreamEvent) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
}

/**
 * 原生 Fetch Stream 解析器，零外部依赖监听后端的 /api/graph/stream SSE 接口
 */
export async function streamGraphAnalysis({
  apiBaseUrl,
  input,
  signal,
  onEvent,
  onError,
  onComplete,
}: StreamGraphOptions): Promise<void> {
  const url = `${apiBaseUrl}/api/graph/stream?input=${encodeURIComponent(input.trim())}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
      },
      signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`流式接口返回异常 (${res.status}): ${errText || res.statusText}`);
    }

    if (!res.body) {
      throw new Error("响应体为空，无法建立流式传输");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      // 保留未完成的最后一行到 buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue; // 忽略心跳或空行

        if (trimmed.startsWith("data:")) {
          const rawData = trimmed.slice(5).trim();
          if (!rawData) continue;

          try {
            const parsed = JSON.parse(rawData) as GraphStreamEvent;
            onEvent(parsed);
          } catch {
            // 非 JSON 字符串或结束标记忽略
          }
        }
      }
    }

    // 处理残余 buffer
    if (buffer.trim().startsWith("data:")) {
      const rawData = buffer.trim().slice(5).trim();
      try {
        const parsed = JSON.parse(rawData) as GraphStreamEvent;
        onEvent(parsed);
      } catch {}
    }

    onComplete?.();
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return;
    }
    onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}
