@echo off
chcp 65001 >nul
title AI-CustomerService-Frontend-5173
cd /d "%~dp0"
call npm run dev
echo.
echo frontend stopped.
pause
