#!/bin/zsh
# 批量生图：读取任务表（每行：输出路径<TAB>参考图或-<TAB>英文描述），并行调用 gen-art.sh。
# 用法：scripts/gen-art-batch.sh art-src/jobs/batch2.tsv [并行数=4]
# 已存在的输出会跳过；日志在 art-src/raw/.logs/。完成后运行 python3 scripts/process-art.py。
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JOBS="$1"; PAR="${2:-4}"
mkdir -p "$ROOT/art-src/raw/.logs"
run_one() {
  local out="$1" ref="$2" desc="$3"
  [ -f "$ROOT/art-src/raw/$out" ] && return 0
  mkdir -p "$ROOT/art-src/raw/$(dirname "$out")"
  "$ROOT/scripts/gen-art.sh" "$out" "$ref" "$desc" > "$ROOT/art-src/raw/.logs/${out//\//__}.log" 2>&1
  [ -f "$ROOT/art-src/raw/$out" ] && echo "ok   $out" || echo "FAIL $out"
}
n=0
while IFS=$'\t' read -r out ref desc; do
  [ -z "$out" ] && continue
  run_one "$out" "$ref" "$desc" &
  n=$((n+1))
  if [ $((n % PAR)) -eq 0 ]; then wait; fi
done < "$JOBS"
wait
echo "batch done"
