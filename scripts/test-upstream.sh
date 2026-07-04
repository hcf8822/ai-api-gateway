#!/bin/bash
set -e

echo ""
echo "============================================"
echo "   Configure QuickRouter as Upstream"
echo "============================================"
echo ""

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }

info "This script helps you verify your QuickRouter API key."
echo ""

read -p "Enter your QuickRouter API key (sk-xxx): " API_KEY

if [ -z "$API_KEY" ]; then
    echo "No key entered. Exiting."
    exit 1
fi

echo ""
echo "Testing connection to QuickRouter..."
echo ""

RESULT=$(curl -s -w "\n%{http_code}" \
    https://api.quickrouter.ai/v1/models \
    -H "Authorization: Bearer ${API_KEY}")

HTTP_CODE=$(echo "$RESULT" | tail -1)
BODY=$(echo "$RESULT" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    info "QuickRouter connection successful!"
    echo ""
    echo "Available models (first 20):"
    echo "$BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
models = data.get('data', [])
print(f'Total models: {len(models)}')
print()
for m in models[:20]:
    print(f'  - {m[\"id\"]}')
if len(models) > 20:
    print(f'  ... and {len(models) - 20} more')
" 2>/dev/null || echo "$BODY" | head -50

    echo ""
    echo "QuickRouter models endpoint is working."
    echo ""
    echo "Now add QuickRouter as a channel in New-API:"
    echo "  1. Open http://YOUR_SERVER:3000"
    echo "  2. Login (root / 123456)"
    echo "  3. Channels -> Add Channel"
    echo "  4. Fill in:"
    echo "     - Type:    OpenAI"
    echo "     - Base URL: https://api.quickrouter.ai"
    echo "     - Key:     ${API_KEY}"
    echo "     - Models:   gpt-4o,gpt-4o-mini,claude-sonnet-4-20250514,deepseek-chat"
    echo "  5. Click Test, then Save"
else
    echo "HTTP $HTTP_CODE"
    echo "$BODY"
    echo ""
    echo "Connection failed. Check your API key."
fi
