# Trello MCP Enhanced

An enhanced [Model Context Protocol](https://modelcontextprotocol.io/) server for Trello, designed for use with [Claude Code](https://claude.ai/claude-code).

Browse boards, filter cards by label, move tasks between lists, and add comments — all through natural conversation with Claude.

## Key Features

- **Auto-config** — on first use, the server discovers your boards and caches labels/lists. No manual board ID wrangling.
- **Name-based lookups** — use `listName: "Inbox"`, `labelName: "Bug"`, or `boardName: "My Board"` instead of raw IDs.
- **Multi-board caching** — boards, labels, and lists are lazily cached per board as you use them. The config builds up over time.
- **Auto-refresh** — cached data auto-refreshes every 24 hours to stay current.
- **Board-scoped search** — find cards by name, description, or label within your default board.
- **Smart attachments** — images return inline; non-image files save to a temp directory.

## What's Included

| Tool | Description |
|------|-------------|
| `trello_get_my_boards` | List all your Trello boards |
| `trello_set_default_board` | Set the default board and cache its labels/lists |
| `trello_refresh_config` | Re-fetch cached labels and lists for the default board |
| `trello_get_config` | View the current cached config (boards, labels, lists) |
| `trello_get_board_labels` | Get all labels on a board (default board if omitted) |
| `trello_get_cards_by_label` | Filter cards by label name or ID |
| `trello_get_cards_by_list` | Get all cards in a list by name or ID |
| `trello_search_cards` | Search cards within a board by keyword |
| `trello_move_card` | Move a card to a list by name or ID |
| `trello_add_comment` | Add a comment to a card |
| `trello_add_card` | Create a new card (list and labels by name) |
| `trello_update_card` | Update card properties (list and labels by name) |
| `trello_archive_card` | Archive a card |
| `trello_get_lists` | List all lists on a board |
| `trello_add_list` | Create a new list |
| `trello_archive_list` | Archive a list by name or ID |
| `trello_get_recent_activity` | Get recent board activity |
| `trello_get_my_cards` | Get all cards assigned to you |
| `trello_search_all_boards` | Search across all boards |
| `trello_get_card_attachments` | List attachments on a card |
| `trello_download_attachment` | Download an attachment (images inline, files to temp path) |

## Prerequisites

- **Node.js** 16 or higher
- **Claude Code** CLI installed
- **Trello account** with API access

## Setup

### 1. Get your Trello API credentials

1. Go to [trello.com/power-ups/admin](https://trello.com/power-ups/admin)
2. Create a new Power-Up (or select an existing one)
3. Copy your **API Key**
4. Click the link to generate a **Token** — authorize it when prompted

### 2. Clone and run setup

```bash
git clone <your-repo-url> trello-mcp-enhanced
cd trello-mcp-enhanced
bash setup.sh
```

The setup script will:
- Ask for your API key and token
- Install dependencies and build the project
- Register the MCP server with Claude Code

### Manual setup (if you prefer)

```bash
git clone <your-repo-url> trello-mcp-enhanced
cd trello-mcp-enhanced
npm install
npm run build

claude mcp add --scope user trello \
  -e TRELLO_API_KEY=your_api_key \
  -e TRELLO_TOKEN=your_token \
  -- node "$(pwd)/build/index.js"
```

## Configuration

On first tool call, the server auto-generates `trello-config.json` with your default board, cached labels, and cached lists. This file is gitignored — see `trello-config.example.json` for the format.

The config caches data at two levels:
- **Default board**: labels and lists cached at the top level
- **Other boards**: labels and lists lazily cached in `boardCache` when first accessed

The cache auto-refreshes every 24 hours. To **manually refresh**: call `trello_refresh_config`.
To **switch boards**: call `trello_set_default_board` with the new board ID.
To **view cached data**: call `trello_get_config`.

## Usage

Once set up, just talk to Claude naturally:

- "List my Trello boards"
- "Show me the Inbox"
- "What bugs do we have?"
- "Show me the lists on Shell Shockers Working Board"
- "Move that card to In Progress"
- "Add a comment saying I'm working on this"
- "Create a new card for adding dark mode in the Inbox with the Feature Request label"
- "Search for cards about onboarding"

## CLAUDE.md

This repo includes a `CLAUDE.md` file that teaches Claude how to use the Trello tools effectively — label taxonomy, workflow patterns, and formatting guidelines.

## Credits

Built on top of [claude-mcp-trello](https://github.com/hrs-asano/claude-mcp-trello) by hrs-asano. Enhanced with auto-config, name-based lookups, multi-board caching, auto-refresh, board-scoped search, and smart attachments.

## License

MIT
