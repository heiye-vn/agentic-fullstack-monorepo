# 第十七章 17.4：最小 RAGAS 评估服务
# 起在 :8000，与 ragas-runner.ts 的默认端点保持一致
FROM python:3.12-slim

WORKDIR /app

# datasets / ragas 依赖编译较重，先单独一层装依赖，改 app.py 时不必重装
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
