@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  set "NODE=C:\Users\31725\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
) else (
  set "NODE=node"
)

if not exist "dist\index.html" (
  echo 还没有打包，请先运行: pnpm build
  pause
  exit /b 1
)

echo 正在启动牧场打字物语...
start "" /min "%NODE%" serve.mjs 5181
timeout /t 1 >nul
start "" http://127.0.0.1:5181/
