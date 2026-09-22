#!/usr/bin/env bash
# 无 Docker 时本地裸跑 RAGAS 服务（第十七章 17.4）
#
#   bash infra/compose/ragas/run-local.sh
#
# 起在 :8000，与 ragas-runner.ts 的默认端点和 --host 0.0.0.0 对齐。
# 依赖 OPENAI_API_KEY（faithfulness 内部要把答案拆成 claims 逐条调 LLM）。
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

: "${OPENAI_API_KEY:?需要设置 OPENAI_API_KEY（RAGAS 评 faithfulness 内部要调 LLM）}"
echo "RAGAS 服务将起在 http://localhost:8000/evaluate（/health 可探活）"
exec uvicorn app:app --host 0.0.0.0 --port 8000
