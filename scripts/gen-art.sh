#!/bin/zsh
# 用本机 ChatGPT 应用自带的 codex 命令行生成一张美术原图。
# 用法：scripts/gen-art.sh <输出文件名（存入 art-src/raw/）> <参考图路径或 -> "<英文画面描述>"
# 生成后再运行 python3 scripts/process-art.py 把原图处理成 public/art 下的 webp。
set -e
CODEX="${CODEX_BIN:-/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$1"; REF="$2"; DESC="$3"
cd "$ROOT/art-src/raw"
PROMPT="Use your built-in image generation tool to create ONE image and save it as ./$OUT in the current directory. Do nothing else: do not write code, do not touch any other files or directories. The image: $DESC When done, print the saved file path and the pixel size."
if [ "$REF" = "-" ]; then
  "$CODEX" exec --skip-git-repo-check -C . -c model_reasoning_effort='"low"' "$PROMPT" < /dev/null
else
  "$CODEX" exec --skip-git-repo-check -C . -c model_reasoning_effort='"low"' "$PROMPT" -i "$ROOT/$REF" < /dev/null
fi
