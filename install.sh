#!/bin/bash
set -e

if [ -z "$SAIA_API_KEY" ]; then
  echo "Error: SAIA_API_KEY is not set."
  echo "Get your key from https://chat-ai.academiccloud.de/ then run:"
  echo "  export SAIA_API_KEY=your_key_here"
  exit 1
fi

TARGET_DIR="${HOME}/.config/opencode/plugins/saia"
mkdir -p "$TARGET_DIR"

cp -r src/* "$TARGET_DIR/"
chmod +x "$TARGET_DIR/generate-saia-config.sh"
chmod +x "$TARGET_DIR/copy-saia-config.sh"

CONFIG_FILE="${HOME}/.config/opencode/opencode.json"
 if [ ! -f "$CONFIG_FILE" ]; then
   mkdir -p "$(dirname "$CONFIG_FILE")"
   cat > "$CONFIG_FILE" <<'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["./saia/saia"]
}
EOF
   echo "✓ Created $CONFIG_FILE with plugin registration"
 else
   echo "⚠ Config exists at $CONFIG_FILE"
   echo "  Add 'plugin' registration if not already present"
 fi

echo ""
echo "✓ Plugin installed to $TARGET_DIR"
echo "  Run 'opencode' in any project to use SAIA models"
