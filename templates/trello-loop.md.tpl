# Trello QA Loop — Setup Guide

Automated workflow that monitors the Trello **"{{WATCH_LIST_NAME}}"** list, classifies changes by complexity, applies them, and tracks results back to Trello.

All project-specific values (list IDs, repos, branches, limits, classification rules) live in **`.trello/trello-loop-config.yaml`** at the project root. Update that file to reconfigure the loop.

---

## Prerequisites

1. **Trello MCP** server configured and working (`trello-mcp-enhanced` v2.0+)
2. **GitHub CLI** authenticated: `gh auth login`
3. **`{{SHIPIT_SCRIPT}}`** in the project root and executable: `chmod +x {{SHIPIT_SCRIPT}}`
4. **Correct branches checked out**:
{{BRANCH_CHECK_LINES}}

---

## Change Classification

Read classification rules from `.trello/trello-loop-config.yaml`. Every card is classified into one of three tiers:

| Tier | What qualifies | Action | Trello outcome |
|------|---------------|--------|----------------|
| **Simple text** | Typo fixes, copy changes, string replacements — no logic, no imports, no structure | Direct push via `{{SHIPIT_SCRIPT}} --direct` | Card → **{{READY_FOR_QA_LIST_NAME}}** |
| **Complex but doable** | Items listed in `classification.complexDoable` in config | PR via `{{SHIPIT_SCRIPT}}` (branch + PR) | Card → **{{IN_PROGRESS_LIST_NAME}}** |
| **Out of scope** | Matches `classification.outOfScope` patterns, keywords, or descriptions; or exceeds `maxFilesPerCard` | No code changes made | Card → **{{INBOX_LIST_NAME}}** with comment |

---

## Trello Card Format

Cards in the **"{{WATCH_LIST_NAME}}"** list should describe the desired change clearly. For text changes, this structured format enables the fastest (automated) processing:

```
Route or description for where the text change is needed.

## Current Text
The exact text currently in the file

## New Text
The replacement text
```

For non-text changes, a clear description of the desired change is sufficient. The automation will classify it and act accordingly.

### Rules for Cards

- **Max files**: check `classification.maxFilesPerCard` in config — if more files are needed, create separate cards
- **Exact text** — for text changes, "Current Text" must match the file exactly (whitespace, casing, punctuation)
- **No deleting, removing or destruction**
- **NO inappropriate language**
- Place the card in the **"{{WATCH_LIST_NAME}}"** list

---

## PR Body Template

Each PR opened by the automation (complex-but-doable changes) looks like this:

```markdown
## QA Change

**Reported by**: {author name} (via Trello)
**Card**: [{card title}]({card url})

**File(s)**: `{file path}`

**Change**:
{description of what was changed and why}

---
*Automated by QA Loop — review and merge to deploy.*
```

---

## Starting the Loop

The MCP server handles background polling automatically. Claude only needs a lightweight loop to check for pending work:

```
/loop {{POLL_INTERVAL}}m @.trello/trello-loop.md Call trello_get_pending_work. If empty, stop. Otherwise process pending items per the classification rules in .trello/trello-loop-config.yaml. Use acceptEdits mode.
```

> **Permission mode**: The loop runs with `acceptEdits` so file edits don't prompt for approval. Scoped to the loop only.
>
> **Token efficiency**: The MCP server polls Trello and checks PRs in the background. On idle cycles, Claude only makes one tool call and gets an empty response — minimal token usage.

### What the loop does each cycle

**Phase 1 — Process new cards:**

1. Call `trello_get_pending_work`. If empty, stop.

2. For auto-completed cards (`autoResult.status === "success"`): add a QA instruction comment to the Trello card.

3. For auto-failed cards (`autoResult.status === "error"`): read the error, investigate, and attempt to fix following the classification rules in `.trello/trello-loop-config.yaml`.

4. For complex cards (`classification === "complex"`): handle the edit manually, then ship via PR using `{{SHIPIT_SCRIPT}}` with the repo config from `.trello/trello-loop-config.yaml`.

5. For out-of-scope cards already handled by MCP: no action needed.

6. VERIFY any change is safe before shipping:
   - For text changes: current text must appear exactly once in the file
   - No new import statements, function definitions, or deleted code blocks
   - No deleting, removing, or destruction
   - No inappropriate language
   - If verification fails, move card to **{{INBOX_LIST_NAME}}**, comment explaining why

7. SHIP the change:
   - Determine which repo using `repos[].pathPrefix` from config
   - Use `gh -R {repos[].ghSlug}` for all GitHub CLI commands (never `cd`)

   **Simple text** → `./{{SHIPIT_SCRIPT}} --direct <repo-name> <card-id> "QA: <title> [<id>]"`
   **Complex doable** → `./{{SHIPIT_SCRIPT}} <repo-name> <card-id> "QA: <title> [<id>]" "<pr-title>" "<pr-body>"`

8. ON SUCCESS:
   - Simple text: move card to **{{READY_FOR_QA_LIST_NAME}}**, comment with commit hash
   - Complex PR: move card to **{{IN_PROGRESS_LIST_NAME}}**, comment with PR URL

9. ON ANY FAILURE:
   - Reset any uncommitted file changes (`git checkout -- .`)
   - Move card to **{{INBOX_LIST_NAME}}**
   - Add a clear comment explaining what went wrong

**Phase 2 — Monitor PR status (handled by MCP):**

The MCP server handles PR monitoring autonomously. If `trello_get_pending_work` returns `prUpdates`, Claude adds QA instruction comments where needed.

---

## Stopping the Loop

```
cancel the QA loop
```

Or: `what scheduled tasks do I have?` — then cancel the relevant one.

---

## Troubleshooting

| Problem | Check |
|---------|-------|
| Loop doesn't pick up cards | Is the card in the **{{WATCH_LIST_NAME}}** list? |
| "File not found" errors | Card must use paths relative to project root |
| "Text not found" errors | Ensure "Current Text" is exact — check whitespace, quotes, line breaks |
| "Text appears multiple times" | Add more surrounding context to "Current Text" |
| Branch already exists | A PR for this card is already open — check GitHub |
| `gh` not authenticated | Run `gh auth login` |
| PR creation fails | Check `gh auth status` and push access |
| Script permission denied | Run `chmod +x {{SHIPIT_SCRIPT}}` |
| "Manual approval required" | Use `gh -R` from config instead of `cd && gh` |
| Card moved to Inbox unexpectedly | Read the comment — it explains the classification |
| Config not found | Ensure `.trello/trello-loop-config.yaml` exists at the project root |

---

## How It Works (Technical)

```
MCP Server (background, every {{POLL_INTERVAL}} minutes):
  ┌─ Fetch cards from {{WATCH_LIST_NAME}}
  │   ├─ Classify each card
  │   ├─ Simple text? → auto find/replace → shipit --direct → update Trello
  │   ├─ Out of scope? → move to {{INBOX_LIST_NAME}} + comment
  │   └─ Cache results
  │
  ├─ Check PRs via gh -R (each repo from config)
  │   ├─ Merged → move card to {{READY_FOR_QA_LIST_NAME}} + comment
  │   └─ Closed → move card to {{INBOX_LIST_NAME}} + comment
  │
  └─ Results cached in memory

Claude Loop (every {{POLL_INTERVAL}} minutes):
  ┌─ Call trello_get_pending_work
  │
  ├─ Empty? → stop (minimal tokens)
  ├─ Auto-completed → add QA instruction comment
  ├─ Auto-failed → investigate + fix
  ├─ Complex → edit + PR via {{SHIPIT_SCRIPT}}
  └─ PR updates → add QA comments
```

---

## Safety Guards

- **Config-driven**: all project-specific values in `.trello/trello-loop-config.yaml`
- **Three-tier classification**: changes assessed before any code is touched
- **Out-of-scope rejection**: matched against `outOfScope.filePatterns` and `outOfScope.keywords`
- **PR-based for complex changes**: no direct pushes beyond simple text
- **Branch guard**: `{{SHIPIT_SCRIPT}}` refuses to run if not on the deploy branch
- **Branch collision**: refuses if branch already exists
- **Text-only verification**: rejects cards adding imports, functions, or structural changes
- **No destruction**: rejects cards that delete or remove content
- **Content filter**: rejects inappropriate language
- **Single occurrence**: rejects ambiguous edits where text appears multiple times
- **One card per cycle**: prevents cascading failures
- **Auto-cleanup**: on failure, branches are deleted and repo returns to deploy branch
- **No force push**: fails gracefully if remote rejects
- **File limit**: exceeding `maxFilesPerCard` is out of scope
- **gh -R flag**: all GitHub CLI commands use `-R` to avoid permission issues
