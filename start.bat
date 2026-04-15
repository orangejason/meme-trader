@echo off
chcp 65001 >nul
title Meme Trader
echo === Meme Trader 启动 ===

:: 先杀掉所有旧的 Python main.py 进程（防止多进程同时买入）
echo 清理旧进程...
for /f "tokens=2" %%i in ('tasklist /fi "imagename eq python.exe" /fo csv /nh 2^>nul') do (
    wmic process where "ProcessId=%%~i" get CommandLine 2>nul | findstr "main.py" >nul 2>&1
    if not errorlevel 1 (
        taskkill /PID %%~i /F >nul 2>&1
    )
)
timeout /t 1 /nobreak >nul

:: 找一个可用端口（从8000开始，跳过被占用的）
set BACKEND_PORT=9000
:check_port
netstat -ano | findstr ":%BACKEND_PORT% " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    set /a BACKEND_PORT+=1
    goto check_port
)
echo 后端将使用端口: %BACKEND_PORT%

:: 启动后端（同时 serve 前端 dist，无需 Node.js）
echo 启动后端...
start "Meme Trader" cmd /k "cd /d "%~dp0backend" && set BACKEND_PORT=%BACKEND_PORT% && python main.py"

:: 等待后端启动
timeout /t 5 /nobreak >nul

echo.
echo 启动完成！
echo   访问地址: http://localhost:%BACKEND_PORT%
echo.
timeout /t 2 /nobreak >nul
start http://localhost:%BACKEND_PORT%
