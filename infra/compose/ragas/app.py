"""
最小本地 RAGAS 服务（第十七章 17.4）

协议与既有客户端 services/chat/src/rag/evaluation/ragas-runner.ts 完全对齐：
  POST /evaluate  body = { samples: [{question, answer, contexts, ground_truth?}], metrics: [str] }
  resp = { "<metric>": float, ... }

端口固定 8000：ragas-runner.ts 的默认端点是
`process.env.RAGAS_ENDPOINT || 'http://localhost:8000/evaluate'`，
不要改到别的端口 —— 改了以后不配环境变量就静默连不上。

注意：RAGAS 评 faithfulness 内部会调 LLM（把答案拆成 claims 逐条判断），
因此本服务依赖 OPENAI_API_KEY，评测会烧 token —— 属「离线、按需触发」，
run-eval.ts 里由 RUN_RAGAS=1 控制。
"""
from fastapi import FastAPI
from pydantic import BaseModel
from ragas import evaluate
from ragas.metrics import faithfulness, answer_relevancy
from datasets import Dataset

app = FastAPI(title="autix-ragas", version="1")

METRIC_MAP = {"faithfulness": faithfulness, "answer_relevancy": answer_relevancy}


class Sample(BaseModel):
    question: str
    answer: str
    contexts: list[str]
    ground_truth: str | None = None


class Req(BaseModel):
    samples: list[Sample]
    metrics: list[str]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/evaluate")
def run(req: Req):
    ds = Dataset.from_list([s.model_dump() for s in req.samples])
    chosen = [METRIC_MAP[m] for m in req.metrics if m in METRIC_MAP]
    result = evaluate(ds, metrics=chosen)
    return {m: float(result[m]) for m in result}
