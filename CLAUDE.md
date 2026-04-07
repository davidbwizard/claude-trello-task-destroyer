# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm run build        # TypeScript compile + chmod +x build/index.js
npm run dev          # Run from source via ts-node --esm
npm start            # Run built output (node build/index.js)
```

There are no tests or linting configured. The project has no test framework.

## Architecture

This is an MCP (Model Context Protocol) server that exposes Trello operations as tools for Claude Code. It communicates over stdio using `@modelcontextprotocol/sdk`.

### Source layout (`src/`)

- **`index.ts`** — Entry point. Defines all MCP tool schemas (22 core + 2 QA automation), registers them with the MCP `Server`, and routes `CallToolRequest` to the appropriate handler logic. All tool handler logic lives inline in this file's giant switch statement.
- **`trello-client.ts`** — HTTP client wrapping the Trello REST API via axios. All API calls go through `handleRequest()` which retries on 429s. Rate-limited by an axios request interceptor.
- **`config.ts`** — Config management. Loads/saves `trello-config.json` (lives at project root, auto-generated on first use). Handles first-use board selection flow, 24h auto-refresh, and name→ID resolution for boards, lists, and labels. Two-tier cache: default board data at top level, other boards lazily cached in `boardCache`.
- **`types.ts`** — All TypeScript interfaces: Trello API response types, QA automation types (`QAAutomationConfig`, `PendingWork`, `CardClassification`, etc.).
- **`rate-limiter.ts`** — Token-bucket rate limiter respecting Trello's limits (300 req/10s per API key, 100 req/10s per token). Used as an axios interceptor in `trello-client.ts`.
- **`qa-automation.ts`** — Background polling system. Watches a Trello list, classifies cards (simple text / complex / out of scope), auto-handles simple find-and-replace edits, monitors PR status via `gh` CLI. Results cached in-memory for `trello_get_pending_work`.
- **`project-init.ts`** — Generates per-project QA config files from templates in `templates/`. Creates `.trello/` directory with YAML config and markdown loop guide.

### Key patterns

- **Name-based resolution**: All tools accept human-readable names (`listName`, `labelName`, `boardName`) in addition to IDs. Resolution goes: check in-memory cache → check config file cache → fetch from API and update cache.
- **Config auto-setup**: `ensureConfig()` runs before every tool call. No config → fetches boards → auto-selects if one board or prompts user. Stale config (>24h) triggers silent background refresh.
- **ES Modules**: The project uses ES2020 modules (`"type": "module"` in package.json). All local imports use `.js` extensions (required for ESM with TypeScript).

### Environment variables

- `TRELLO_API_KEY` — Trello API key (required)
- `TRELLO_TOKEN` — Trello API token (required)

These are passed via the MCP server registration (`claude mcp add -e ...`), not `.env` files.

### Setup

`bash setup.sh` handles the full install: prompts for credentials, runs `npm install && npm run build`, and registers with `claude mcp add --scope user`.

---

## Trello MCP — Workflow Guide

When working with Trello through this MCP server, follow this guided flow:

### Getting Started

On first use, the server auto-configures itself:

1. **Call any tool** — if no config exists, the server fetches your boards automatically
2. If you have **one board**, it's auto-selected as the default
3. If you have **multiple boards**, you'll be prompted to call `trello_set_default_board` with the board ID you want
4. Once a board is selected, labels and lists are cached for name-based lookups
5. All boards are cached by name and ID for quick reference

After setup, `boardId` and `boardName` are optional on all tools — the default board is used automatically.

To **switch boards** later, call `trello_set_default_board` with a new board ID.
To **refresh cached labels/lists** (e.g. after adding new ones on Trello), call `trello_refresh_config`.

### Using the Config Cache

Call `trello_get_config` first to check cached boards, lists, and labels before making API calls. This avoids unnecessary network requests and gives you immediate context about what's available.

The server caches data at two levels:
- **Default board**: labels and lists are cached at the top level
- **Other boards**: labels and lists are lazily cached in `boardCache` the first time any tool targets that board

The cache auto-refreshes every 24 hours. You can force a refresh with `trello_refresh_config`.

### Working with Multiple Boards

All tools accept `boardName` as an alternative to `boardId`:
```
trello_get_lists(boardName: "Shell Shockers Working Board")
trello_get_cards_by_label(boardName: "Shell Shockers Working Board", labelName: "Bug")
```
Board names are resolved case-insensitively from the cached boards list. If omitted, the default board is used.

### Viewing Cards
- To see everything in a list: `trello_get_cards_by_list` — use `listName` (e.g. `"Inbox"`) or `listId`
- To filter by category: `trello_get_cards_by_label` — use `labelName` (e.g. `"Bug"`) or `labelId`
- To search within the board: `trello_search_cards` with a query string
- Always display card labels alongside the card name — they provide important context

### Label Taxonomy
Labels serve two purposes:
- **Primary filters** (card type): `Bug`, `Feature Request` — use these to filter cards
- **Context labels** (area/audience): `Onboarding`, `Kid`, `Teacher`, `Parent`, `Stats`, `Ui`, `Admin dashboard` — these describe what part of the product is affected and who it impacts

When presenting cards, format labels meaningfully. For example:
> "Onboarding returns to onboarding" [Bug] — Onboarding, Kid
> This tells you: it's a bug, in the onboarding flow, affecting the kid-facing experience.

### Creating & Updating Cards
- **Create cards** with `trello_add_card` — use `listName` and `labelNames` instead of IDs:
  ```
  trello_add_card(listName: "Inbox", name: "Fix login bug", labelNames: ["Bug", "Onboarding"])
  ```
- **Update cards** with `trello_update_card` — supports `listName` and `labelNames` too
- **Move between lists** when task status changes: use `trello_move_card` with `listName`
  - Example flow: Inbox → In Progress → Ready for QA → Complete
- **Add comments** to track progress or notes: use `trello_add_comment`

### Attachments
- **List attachments**: `trello_get_card_attachments`
- **Download**: `trello_download_attachment` — images are returned inline; non-image files are saved to a temp directory and the file path is returned

### Best Practices
- Call `trello_get_config` at the start of a session to see what's cached before making API calls
- Always confirm with the user before moving or archiving cards
- When creating cards, suggest appropriate labels based on the card description
- Present cards in a clean table format with labels for quick scanning
- Use name-based params (`listName`, `labelName`, `boardName`) for readability — IDs still work as overrides
