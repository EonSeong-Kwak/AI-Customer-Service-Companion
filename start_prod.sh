#!/bin/bash

echo "====================================="
echo "正在启动 AI 客服陪练正式系统 v1.0"
echo "====================================="

# 设置 HuggingFace 离线模式，跳过模型在线检查（模型已缓存到本地）
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1

# 自动初始化 MySQL 数据库表结构
echo "➡️ 初始化 MySQL 数据库..."
source venv/bin/activate
cd backend
python init_db.py
cd ..

# 启动后端服务 (放入后台)
echo "➡️ 启动后端服务 (FastAPI)..."
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
cd ..

# 等待一小会儿，确保后端启动
sleep 2

# 启动前端服务 (放入后台)
echo "➡️ 启动前端服务 (React + Vite)..."
cd frontend
npm run dev &
FRONTEND_PID=$!

echo "====================================="
echo "✅ 启动完成！"
echo "🌐 请在浏览器中访问: http://localhost:5174/ 或者对应的 Vite 端口"
echo "🛑 按 Ctrl+C 可以同时停止所有服务。"
echo "====================================="

# 捕获 Ctrl+C 信号，以便退出时同时清理前后端进程
trap "echo -e '\n🛑 正在停止服务...'; kill $BACKEND_PID $FRONTEND_PID; exit" INT TERM EXIT

# 保持脚本运行，直到用户按下 Ctrl+C
wait
