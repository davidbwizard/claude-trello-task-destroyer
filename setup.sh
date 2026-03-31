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
  echo "Error: Node.js is not installed. Install Node.js 16+ and try again."
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
  read -p "Trello Token: " TRELLO_TOKEN
fi

if [ -z "$TRELLO_API_KEY" ] || [ -z "$TRELLO_TOKEN" ]; then
  echo "Error: Both API Key and Token are required."
  exit 1
fi

# ----------------------------------------------------------
# 3. Install and build
# ----------------------------------------------------------
echo ""
echo "Installing dependencies..."
cd "$SCRIPT_DIR"
npm install

echo ""
echo "Building..."
npm run build

# ----------------------------------------------------------
# 4. Register with Claude Code
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
  echo "    -e TRELLO_API_KEY=\"$TRELLO_API_KEY\" \\"
  echo "    -e TRELLO_TOKEN=\"$TRELLO_TOKEN\" \\"
  echo "    -- node $SCRIPT_DIR/build/index.js"
fi

echo ""
echo "=== Setup Complete ==="
