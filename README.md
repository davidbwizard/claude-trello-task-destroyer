# Trello MCP Enhanced

An enhanced [Model Context Protocol](https://modelcontextprotocol.io/) server for Trello, designed for use with [Claude Code](https://claude.ai/claude-code).

Browse boards, filter cards by label, move tasks between lists, add comments, and automate QA workflows — all through natural conversation with Claude.

## Key Features

- **Auto-config** — on first use, the server discovers your boards and caches labels/lists. No manual board ID wrangling.
- **Name-based lookups** — use `listName: "Inbox"`, `labelName: "Bug"`, or `boardName: "My Board"` instead of raw IDs.
- **Multi-board caching** — boards, labels, and lists are lazily cached per board as you use them.
- **Auto-refresh** — cached data auto-refreshes every 24 hours to stay current.
- **Board-scoped search** — find cards by name, description, or label within your default board.
- **Smart attachments** — images return inline; non-image files save to a temp directory.
- **QA Automation** — background polling monitors a Trello list, auto-classifies changes, handles simple text edits and PR monitoring autonomously, flags complex work for Claude.
- **Project init** — one tool call generates all config files for a new project, pre-filled from your Trello board.

## Tools

### Core Trello Tools (22)

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
| `trello_get_card_creator` | Get the creator of a card |
| `trello_get_card_attachments` | List attachments on a card |
| `trello_download_attachment` | Download an attachment (images inline, files to temp path) |

### QA Automation Tools (2)

| Tool | Description |
|------|-------------|
| `trello_get_pending_work` | Returns pending QA work from background polling: classified cards and PR status updates. Designed for `/loop` — returns empty when idle for minimal token usage. |
| `trello_init_project` | Generates QA config files for a project from templates. Creates `.trello/trello-loop-config.yaml` and `.trello/trello-loop.md` pre-filled with your Trello lists, repos, and classification rules. |

## Prerequisites

- **Node.js** 16 or higher
- **Claude Code** CLI installed
- **Trello account** with API access
- **GitHub CLI** (`gh`) authenticated — needed for PR monitoring in QA automation

## Setup

Setup is a two-step process: install the MCP server, then initialize each project.

### Step 1: Install the MCP server

This is done once. It registers the server with Claude Code so it's available in all projects.

#### Get your Trello API credentials

1. Go to [trello.com/power-ups/admin](https://trello.com/power-ups/admin)
2. Create a new Power-Up (or select an existing one)
3. Copy your **API Key**
4. Click the link to generate a **Token** — authorize it when prompted

#### Run setup

```bash
git clone <your-repo-url> trello-mcp-enhanced
cd trello-mcp-enhanced
bash setup.sh
```

The setup script will:
- Ask for your API key and token
- Install dependencies and build the project
- Register the MCP server with Claude Code

#### Manual setup (if you prefer)

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

### Step 2: Initialize a project

This is done once per project. Open the project in Claude Code and say:

```
Set up the QA loop for this project
```

Claude will:
1. Call `trello_get_lists` to show your board's lists
2. Ask you to pick: watch list, inbox list, in-progress list, ready-for-QA list
3. Ask about your git repos (name, GitHub slug, deploy branch, path prefix)
4. Ask about classification rules (or use sensible defaults)
5. Call `trello_init_project` with everything collected

This generates three things:
- **`.trello/trello-loop-config.yaml`** — commented YAML config at your project root (human-editable)
- **`.trello/trello-loop.md`** — pre-filled loop setup guide with your project's values
- **`trello-config.json` update** — `qaAutomation` block for the MCP server's background polling

If files already exist, Claude will ask before overwriting (pass `overwrite: true` to replace).

After init, start the loop:

```
/loop 10m @.trello/trello-loop.md Call trello_get_pending_work. If empty, stop. Otherwise process pending items. Use acceptEdits mode.
```

## Configuration

### Server config (`trello-config.json`)

Auto-generated on first tool call. Lives in the MCP repo directory. Contains:
- **Default board**: labels and lists cached at the top level
- **Other boards**: lazily cached in `boardCache` when first accessed
- **QA automation**: `qaAutomation` block (written by `trello_init_project`)

The cache auto-refreshes every 24 hours. Manual refresh: call `trello_refresh_config`.

### Project config (`.trello/trello-loop-config.yaml`)

Generated by `trello_init_project`. Lives at the project root. Commented YAML with:
- Trello list IDs and names
- Git repos (name, slug, deploy branch, path prefix)
- Classification rules (complex-doable list, out-of-scope patterns/keywords)
- Loop settings (poll interval, max files per card, shipit script)

Edit this file directly to tune classification rules, add repos, or change settings.

### Project docs (`.trello/trello-loop.md`)

Generated by `trello_init_project`. Pre-filled setup guide with your project's values. Includes:
- Classification table
- Card format guide
- Loop command (ready to copy-paste)
- Phase 1 and Phase 2 flow
- Troubleshooting table
- Safety guards

## QA Automation

### How it works

When enabled, the MCP server polls the watch list every N minutes (default: 10). Each cycle:

1. **Fetches cards** from the watch list
2. **Classifies** each card:
   - **Simple text** — structured `## Current Text` / `## New Text` format. Server handles find-and-replace, commits, pushes. No AI needed.
   - **Complex but doable** — CSS changes, constant extraction, prop swaps, etc. Flagged for Claude to handle via PR.
   - **Out of scope** — API routes, DB migrations, auth, game mechanics. Card moved back to inbox with a comment.
3. **Monitors PRs** — checks for merged/closed `qa/*` branches via `gh` CLI, moves Trello cards.
4. **Caches results** — `trello_get_pending_work` returns instantly.

Claude's loop calls `trello_get_pending_work` once per cycle. Empty = stop (minimal tokens). Work found = Claude handles judgment calls (complex edits, QA comments, error recovery).

### Card format for simple text changes

```
Route or description for where the change is needed.

## Current Text
Welcome to ChocaBLOC

## New Text
Welcome to ChocaBLOC!
```

Cards with this structure are auto-classified as simple text and handled without AI.

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
- "Set up the QA loop for this project"

## CLAUDE.md

This repo includes a `CLAUDE.md` file that teaches Claude how to use the Trello tools effectively — label taxonomy, workflow patterns, and formatting guidelines.

## Credits

Built on top of [claude-mcp-trello](https://github.com/hrs-asano/claude-mcp-trello) by hrs-asano. Enhanced with auto-config, name-based lookups, multi-board caching, auto-refresh, board-scoped search, smart attachments, QA automation, and project init.

## License

MIT
