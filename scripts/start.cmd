@echo off
REM PersonaBot Windows launcher
REM Usage: scripts\start.cmd [dev|start]
setlocal
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo [personabot] Node.js not found. Install Node ^>= 20: https://nodejs.org
  exit /b 1
)

for /f "tokens=* usebackq" %%v in (`node -p "process.versions.node.split('.')[0]"`) do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo [personabot] Node too old, need ^>= 20, current:
  node -v
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [personabot] Enabling pnpm via corepack...
  corepack enable
)

if not exist node_modules (
  echo [personabot] Installing dependencies...
  call pnpm install
)

if "%~1"=="dev" (
  echo [personabot] Starting in dev mode...
  call pnpm dev
) else (
  echo [personabot] Building and starting production server...
  call pnpm build
  call pnpm start
)
