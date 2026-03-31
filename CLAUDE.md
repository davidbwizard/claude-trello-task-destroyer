# Trello MCP — Workflow Guide

When working with Trello through this MCP server, follow this guided flow:

## Getting Started
1. **List boards** with `trello_get_my_boards` — let the user pick which board to work with
2. **Show lists** on the selected board with `trello_get_lists`
3. **Get labels** with `trello_get_board_labels` so you know what filtering options exist

## Viewing Cards
- To see everything in a list: `trello_get_cards_by_list`
- To filter by category: `trello_get_cards_by_label` (use label ID from step 3)
- Always display card labels alongside the card name — they provide important context

## Label Taxonomy
Labels serve two purposes:
- **Primary filters** (card type): `Bug`, `Feature Request` — use these to filter cards
- **Context labels** (area/audience): `Onboarding`, `Kid`, `Teacher`, `Parent`, `Stats`, `Ui`, `Admin dashboard` — these describe what part of the product is affected and who it impacts

When presenting cards, format labels meaningfully. For example:
> "Onboarding returns to onboarding" [Bug] — Onboarding, Kid
> This tells you: it's a bug, in the onboarding flow, affecting the kid-facing experience.

## Updating Cards
- **Move between lists** when task status changes: use `trello_move_card`
  - Example flow: Inbox → In Progress → Ready for QA → Complete
- **Add comments** to track progress or notes: use `trello_add_comment`
- **Update card details** (title, description, labels, due date): use `trello_update_card`

## Best Practices
- Always confirm with the user before moving or archiving cards
- When creating cards, suggest appropriate labels based on the card description
- Present cards in a clean table format with labels for quick scanning
