# Trello MCP — Workflow Guide

When working with Trello through this MCP server, follow this guided flow:

## Getting Started

On first use, the server auto-configures itself:

1. **Call any tool** — if no config exists, the server fetches your boards automatically
2. If you have **one board**, it's auto-selected as the default
3. If you have **multiple boards**, you'll be prompted to call `trello_set_default_board` with the board ID you want
4. Once a board is selected, labels and lists are cached for name-based lookups
5. All boards are cached by name and ID for quick reference

After setup, `boardId` and `boardName` are optional on all tools — the default board is used automatically.

To **switch boards** later, call `trello_set_default_board` with a new board ID.
To **refresh cached labels/lists** (e.g. after adding new ones on Trello), call `trello_refresh_config`.

## Using the Config Cache

Call `trello_get_config` first to check cached boards, lists, and labels before making API calls. This avoids unnecessary network requests and gives you immediate context about what's available.

The server caches data at two levels:
- **Default board**: labels and lists are cached at the top level
- **Other boards**: labels and lists are lazily cached in `boardCache` the first time any tool targets that board

The cache auto-refreshes every 24 hours. You can force a refresh with `trello_refresh_config`.

## Working with Multiple Boards

All tools accept `boardName` as an alternative to `boardId`:
```
trello_get_lists(boardName: "Shell Shockers Working Board")
trello_get_cards_by_label(boardName: "Shell Shockers Working Board", labelName: "Bug")
```
Board names are resolved case-insensitively from the cached boards list. If omitted, the default board is used.

## Viewing Cards
- To see everything in a list: `trello_get_cards_by_list` — use `listName` (e.g. `"Inbox"`) or `listId`
- To filter by category: `trello_get_cards_by_label` — use `labelName` (e.g. `"Bug"`) or `labelId`
- To search within the board: `trello_search_cards` with a query string
- Always display card labels alongside the card name — they provide important context

## Label Taxonomy
Labels serve two purposes:
- **Primary filters** (card type): `Bug`, `Feature Request` — use these to filter cards
- **Context labels** (area/audience): `Onboarding`, `Kid`, `Teacher`, `Parent`, `Stats`, `Ui`, `Admin dashboard` — these describe what part of the product is affected and who it impacts

When presenting cards, format labels meaningfully. For example:
> "Onboarding returns to onboarding" [Bug] — Onboarding, Kid
> This tells you: it's a bug, in the onboarding flow, affecting the kid-facing experience.

## Creating & Updating Cards
- **Create cards** with `trello_add_card` — use `listName` and `labelNames` instead of IDs:
  ```
  trello_add_card(listName: "Inbox", name: "Fix login bug", labelNames: ["Bug", "Onboarding"])
  ```
- **Update cards** with `trello_update_card` — supports `listName` and `labelNames` too
- **Move between lists** when task status changes: use `trello_move_card` with `listName`
  - Example flow: Inbox → In Progress → Ready for QA → Complete
- **Add comments** to track progress or notes: use `trello_add_comment`

## Attachments
- **List attachments**: `trello_get_card_attachments`
- **Download**: `trello_download_attachment` — images are returned inline; non-image files are saved to a temp directory and the file path is returned

## Best Practices
- Call `trello_get_config` at the start of a session to see what's cached before making API calls
- Always confirm with the user before moving or archiving cards
- When creating cards, suggest appropriate labels based on the card description
- Present cards in a clean table format with labels for quick scanning
- Use name-based params (`listName`, `labelName`, `boardName`) for readability — IDs still work as overrides
