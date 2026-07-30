@echo off
chcp 65001 >nul
title AI-CustomerService-Backend-8000
cd /d "%~dp0"
"%~dp0..\venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir app
echo.
echo backend stopped.
pause
