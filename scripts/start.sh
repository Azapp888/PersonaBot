#!/bin/sh
# PersonaBot 跨平台启动脚本 (Linux/macOS/BSD)
# 用法: ./scripts/start.sh [dev|start]
set -eu

cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "[personabot] 未检测到 Node.js，请安装 Node >= 20: https://nodejs.org" >&2
  exit 1
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "[personabot] Node 版本过低 ($(node -v))，需要 >= 20" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[personabot] 启用 corepack 提供的 pnpm..."
  corepack enable
fi

if [ ! -d node_modules ]; then
  echo "[personabot] 安装依赖..."
  pnpm install
fi

MODE="${1:-start}"
case "$MODE" in
  dev)
    echo "[personabot] 以开发模式启动 (前后端并行热重载)..."
    exec pnpm dev
    ;;
  start)
    echo "[personabot] 构建并启动生产服务..."
    pnpm build
    exec pnpm start
    ;;
  *)
    echo "用法: $0 [dev|start]" >&2
    exit 1
    ;;
esac
