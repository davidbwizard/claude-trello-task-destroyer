#!/bin/bash
#
# Setup script for trello-mcp-enhanced
# Installs dependencies, builds the project, and registers with Claude Code.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Trello MCP Enhanced Setup ==="
echo ""

# ----------------------------------------------------------
# 1. Check prerequisites
# ----------------------------------------------------------
if ! command -v node &> /dev/null; then
  echo "Error: Node.js is not installed. Install Node.js 18+ and try again."
  exit 1
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Error: Node.js 18+ is required (found $(node -v))."
  exit 1
fi

if ! command -v npm &> /dev/null; then
  echo "Error: npm is not installed. Install npm and try again."
  exit 1
fi

if ! command -v claude &> /dev/null; then
  echo "Warning: 'claude' CLI not found. You'll need to register the MCP server manually."
  echo "See README.md for manual setup instructions."
  SKIP_CLAUDE=true
fi

# ----------------------------------------------------------
# 2. Get Trello credentials
# ----------------------------------------------------------
echo "You'll need a Trello API key and token."
echo "  1. Go to: https://trello.com/power-ups/admin"
echo "  2. Create a new Power-Up (or use an existing one)"
echo "  3. Copy the API Key"
echo "  4. Generate a Token using the link on that page"
echo ""

if [ -z "$TRELLO_API_KEY" ]; then
  read -p "Trello API Key: " TRELLO_API_KEY
fi

if [ -z "$TRELLO_TOKEN" ]; then
  read -s -p "Trello Token: " TRELLO_TOKEN
  echo ""  # newline after silent input
fi

if [ -z "$TRELLO_API_KEY" ] || [ -z "$TRELLO_TOKEN" ]; then
  echo "Error: Both API Key and Token are required."
  exit 1
fi

# ----------------------------------------------------------
# 3. Validate credentials
# ----------------------------------------------------------
echo ""
echo "Validating Trello credentials..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "https://api.trello.com/1/members/me?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}")

if [ "$HTTP_STATUS" != "200" ]; then
  echo "Error: Trello API returned HTTP $HTTP_STATUS."
  if [ "$HTTP_STATUS" = "401" ]; then
    echo "Your API key or token is invalid. Double-check both values and try again."
  elif [ "$HTTP_STATUS" = "000" ]; then
    echo "Could not reach the Trello API. Check your internet connection."
  else
    echo "Unexpected error. Verify your credentials at https://trello.com/power-ups/admin"
  fi
  exit 1
fi
echo "Credentials valid."

# ----------------------------------------------------------
# 4. Install and build
# ----------------------------------------------------------
echo ""
echo "Installing dependencies..."
cd "$SCRIPT_DIR"
npm install

echo ""
echo "Building..."
npm run build

# ----------------------------------------------------------
# 5. Register with Claude Code
# ----------------------------------------------------------
if [ "$SKIP_CLAUDE" != "true" ]; then
  echo ""
  echo "Registering MCP server with Claude Code..."

  claude mcp add --scope user trello \
    -e TRELLO_API_KEY="$TRELLO_API_KEY" \
    -e TRELLO_TOKEN="$TRELLO_TOKEN" \
    -- node "$SCRIPT_DIR/build/index.js"

  echo ""
  echo "Done! The 'trello' MCP server is now available in Claude Code."
  echo "Try it out: open Claude Code and say 'List my Trello boards'"
else
  echo ""
  echo "Build complete. To register manually with Claude Code, run:"
  echo ""
  echo "  claude mcp add --scope user trello \\"
  echo "    -e TRELLO_API_KEY=\"\$TRELLO_API_KEY\" \\"
  echo "    -e TRELLO_TOKEN=\"\$TRELLO_TOKEN\" \\"
  echo "    -- node $SCRIPT_DIR/build/index.js"
fi

# ----------------------------------------------------------
# 6. Next steps
# ----------------------------------------------------------
echo ""
echo "─── QA Automation (optional) ───"
echo ""
echo "To set up QA automation for a project:"
echo "  1. Open the project in Claude Code"
echo "  2. Say: 'Set up the QA loop for this project'"
echo "  3. Claude will use trello_init_project to generate config files"
echo ""
echo "─── Updating credentials ───"
echo ""
echo "If your token expires or you need to switch accounts:"
echo "  claude mcp remove trello"
echo "  bash setup.sh"
echo ""
echo "=== Setup Complete ==="
