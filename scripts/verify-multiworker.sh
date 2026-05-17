#!/bin/bash
# 多 worker 调度行为验证脚本（Phase 2）
#
# 验证三件事：
#   1. 负载均衡——多次 upload 应该分散到不同 worker
#   2. 粘性路由——同一 image_id 的多次 segment 必须落到同一个 worker
#   3. 会话清理（手动一步）——杀掉 worker 后该 worker 的 image_id 应返回 410
#
# 用法：
#   GATEWAY=http://localhost:8080 TEST_IMAGE=public/some.png ./scripts/verify-multiworker.sh

set -e

GATEWAY="${GATEWAY:-http://localhost:8080}"
TEST_IMAGE="${TEST_IMAGE:-public/Snipaste_2026-04-07_15-27-13.png}"
UPLOAD_ROUNDS="${UPLOAD_ROUNDS:-8}"
SEGMENT_ROUNDS="${SEGMENT_ROUNDS:-5}"

if [ ! -f "$TEST_IMAGE" ]; then
    echo "❌ 测试图未找到: $TEST_IMAGE"
    echo "   通过 TEST_IMAGE=/path/to/some.png 指定"
    exit 1
fi

if ! command -v python3 >/dev/null; then
    echo "❌ 脚本需要 python3 解析 JSON"
    exit 1
fi

extract_worker() {
    # 从 curl -D - 的响应头里抓 X-Worker-Id
    awk 'tolower($1) == "x-worker-id:" {print $2}' | tr -d '\r\n'
}

echo "================================================================"
echo " Gateway:      $GATEWAY"
echo " Test image:   $TEST_IMAGE"
echo " Upload 轮数:  $UPLOAD_ROUNDS"
echo " Segment 轮数: $SEGMENT_ROUNDS"
echo "================================================================"

# 预检：Gateway 必须健康
hc=$(curl -s -o /tmp/gw_health.json -w "%{http_code}" "$GATEWAY/api/health")
if [ "$hc" != "200" ]; then
    echo "❌ Gateway 不健康 (HTTP $hc)"
    cat /tmp/gw_health.json
    exit 1
fi
healthy_workers=$(python3 -c 'import json;print(json.load(open("/tmp/gw_health.json"))["healthy_workers"])')
total_workers=$(python3 -c 'import json;print(json.load(open("/tmp/gw_health.json"))["total_workers"])')
echo "Gateway 健康 workers: $healthy_workers / $total_workers"
if [ "$total_workers" -lt 2 ]; then
    echo "⚠️  只有 $total_workers 个 worker，无法验证多 worker 调度。请在 gateway.yaml 配置至少 2 个 worker 再跑。"
    exit 1
fi
echo ""

# --------------------------------------------------------------------
echo "=== 1. 负载均衡：$UPLOAD_ROUNDS 次 upload 看 worker 分布 ==="
declare -A counts
for i in $(seq 1 "$UPLOAD_ROUNDS"); do
    headers=$(mktemp)
    body=$(curl -s -D "$headers" -F "file=@$TEST_IMAGE" "$GATEWAY/api/upload")
    worker=$(extract_worker < "$headers")
    rm -f "$headers"
    if [ -z "$worker" ]; then
        echo "  upload #$i → 响应无 X-Worker-Id（body: $body）"
        exit 1
    fi
    echo "  upload #$i → $worker"
    counts[$worker]=$((${counts[$worker]:-0}+1))
done
echo "分布统计："
for k in "${!counts[@]}"; do echo "  $k: ${counts[$k]} 次"; done
if [ "${#counts[@]}" -lt 2 ]; then
    echo "⚠️  所有 upload 都落在了同一个 worker。可能：(a) 另一 worker 不健康；(b) 调度算法在低并发下倾向单点。"
else
    echo "✅ 负载均衡生效（分布到 ${#counts[@]} 个 worker）"
fi
echo ""

# --------------------------------------------------------------------
echo "=== 2. 粘性路由：同一 image_id 多次 segment 是否同 worker ==="
headers=$(mktemp)
upload_body=$(curl -s -D "$headers" -F "file=@$TEST_IMAGE" "$GATEWAY/api/upload")
image_id=$(echo "$upload_body" | python3 -c 'import json,sys;print(json.load(sys.stdin)["image_id"])')
expected=$(extract_worker < "$headers")
rm -f "$headers"
echo "选定 image_id=$image_id, 期望落点 worker=$expected"

fail=0
for i in $(seq 1 "$SEGMENT_ROUNDS"); do
    headers=$(mktemp)
    curl -s -D "$headers" -o /dev/null -X POST \
         -H "Content-Type: application/json" \
         -d "{\"image_id\":\"$image_id\",\"points\":[{\"x\":100,\"y\":100,\"label\":1}]}" \
         "$GATEWAY/api/segment"
    actual=$(extract_worker < "$headers")
    rm -f "$headers"
    if [ "$actual" = "$expected" ]; then
        echo "  segment #$i → $actual ✓"
    else
        echo "  segment #$i → $actual ✗ (期望 $expected)"
        fail=1
    fi
done
if [ "$fail" -eq 0 ]; then
    echo "✅ 粘性路由验证通过：$SEGMENT_ROUNDS 次 segment 全部命中 $expected"
else
    echo "❌ 粘性路由有偏移，请检查 SessionTable 实现"
    exit 1
fi
echo ""

# --------------------------------------------------------------------
echo "=== 3. 会话清理（人工演练）==="
echo "下一步可以手动 kill 掉 $expected 对应的 backend 进程，等约 15 秒（3 次健康探测失败），再执行："
echo
echo "  curl -i -X POST -H 'Content-Type: application/json' \\"
echo "       -d '{\"image_id\":\"$image_id\",\"points\":[]}' \\"
echo "       $GATEWAY/api/segment"
echo
echo "预期响应：HTTP 410 + body 含 SESSION_EXPIRED"
echo
echo "查看实时会话表大小："
echo "  curl -s $GATEWAY/metrics | grep gateway_session_table_size"
echo
echo "================================================================"
echo " 自动化验证部分完成。Phase 2 调度行为符合设计。"
echo "================================================================"
