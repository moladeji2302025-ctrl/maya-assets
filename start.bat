@echo off
title Maya Asset Library
cd /d "%~dp0backend"
echo Starting Maya Asset Library backend...
echo Open http://localhost:8000 in your browser.
echo.
echo Set ANTHROPIC_API_KEY before starting if you haven't already:
echo   set ANTHROPIC_API_KEY=sk-ant-...
echo.
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
pause
