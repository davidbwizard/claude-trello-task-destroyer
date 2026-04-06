#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequest,
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { TrelloClient } from "./trello-client.js";
import {
  ensureConfig,
  buildConfigForBoard,
  loadConfig,
  saveConfig,
  clearConfigCache,
  resolveBoardId,
  resolveListId,
  resolveLabelId,
  resolveLabelIds,
  TrelloMcpConfig,
  ensureBoardCached,
} from "./config.js";

// ============================================================
// Tool definitions
// ============================================================

// -- Boards --------------------------------------------------

const trelloGetMyBoardsTool: Tool = {
  name: "trello_get_my_boards",
  description:
    "Lists all Trello boards accessible to the authenticated user. Returns board id, name, description, and URL. Use this as the starting point to let the user pick a board.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

// -- Config --------------------------------------------------

const trelloSetDefaultBoardTool: Tool = {
  name: "trello_set_default_board",
  description:
    "Sets the default board for all subsequent tool calls. Fetches and caches the board's labels and lists for name-based lookups. Call this when prompted during first-use setup, or to switch boards.",
  inputSchema: {
    type: "object",
    properties: {
      boardId: {
        type: "string",
        description: "The ID of the board to set as default",
      },
    },
    required: ["boardId"],
  },
};

const trelloRefreshConfigTool: Tool = {
  name: "trello_refresh_config",
  description:
    "Re-fetches and caches labels and lists for the default board. Use this after adding/renaming labels or lists on Trello so the server's cache stays current.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

const trelloGetConfigTool: Tool = {
  name: "trello_get_config",
  description:
    "Returns the current server config: default board, cached boards, labels, lists, and board cache. Use this to understand what boards and data are available without making API calls.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

// -- Labels --------------------------------------------------

const trelloGetBoardLabelsTool: Tool = {
  name: "trello_get_board_labels",
  description:
    "Retrieves all labels defined on a board. Uses default board if boardId is omitted. Labels like 'Bug' and 'Feature Request' are primary filters; others (e.g. 'Onboarding', 'Kid') provide context about the affected area or audience.",
  inputSchema: {
    type: "object",
    properties: {
      boardId: {
        type: "string",
        description:
          "Board ID (optional — uses default board if omitted)",
      },
      boardName: {
        type: "string",
        description:
          "Board name (alternative to boardId — resolved via cached boards)",
      },
    },
  },
};

// -- Cards ---------------------------------------------------

const trelloGetCardsByListTool: Tool = {
  name: "trello_get_cards_by_list",
  description:
    "Retrieves all cards in a specific list. Provide listId or listName (resolved from cache). Uses default board if boardId/boardName is omitted.",
  inputSchema: {
    type: "object",
    properties: {
      boardId: {
        type: "string",
        description: "Board ID (optional — uses default)",
      },
      boardName: {
        type: "string",
        description: "Board name (alternative to boardId)",
      },
      listId: {
        type: "string",
        description: "Trello list ID",
      },
      listName: {
        type: "string",
        description:
          "List name (alternative to listId — resolved via cached config)",
      },
    },
  },
};

const trelloGetCardsByLabelTool: Tool = {
  name: "trello_get_cards_by_label",
  description:
    "Retrieves all open cards on a board that have a specific label. Provide labelId or labelName. Uses default board if boardId/boardName is omitted.",
  inputSchema: {
    type: "object",
    properties: {
      boardId: {
        type: "string",
        description: "Board ID (optional — uses default)",
      },
      boardName: {
        type: "string",
        description: "Board name (alternative to boardId)",
      },
      labelId: {
        type: "string",
        description: "The ID of the label to filter by",
      },
      labelName: {
        type: "string",
        description:
          "Label name (alternative to labelId — resolved via cached config)",
      },
    },
  },
};

const trelloAddCardTool: Tool = {
  name: "trello_add_card",
  description:
    "Creates a new card in a specified list. Provide listId or listName. Labels can be IDs or names. Uses default board if boardId/boardName is omitted.",
  inputSchema: {
    type: "object",
    properties: {
      boardId: {
        type: "string",
        description: "Board ID (optional — uses default)",
      },
      boardName: {
        type: "string",
        description: "Board name (alternative to boardId)",
      },
      listId: {
        type: "string",
        description: "The ID of the list to add the card to",
      },
      listName: {
        type: "string",
        description: "List name (alternative to listId)",
      },
      name: { type: "string", description: "The title of the card" },
      description: {
        type: "string",
        description: "Card description / details (optional)",
      },
      dueDate: {
        type: "string",
        description: "Due date in ISO 8601 format (optional)",
      },
      labels: {
        type: "array",
        description: "Array of label IDs to apply (optional)",
        items: { type: "string" },
      },
      labelNames: {
        type: "array",
        description:
          "Array of label names to apply (alternative to labels — resolved via cache)",
        items: { type: "string" },
      },
    },
    required: ["name"],
  },
};

const trelloUpdateCardTool: Tool = {
  name: "trello_update_card",
  description:
    "Updates a card's properties: name, description, due date, labels, or list. Lists and labels can be specified by name. Uses default board if boardId/boardName is omitted.",
  inputSchema: {
    type: "object",
    properties: {
      boardId: {
        type: "string",
        description: "Board ID (optional — uses default)",
      },
      boardName: {
        type: "string",
        description: "Board name (alternative to boardId)",
      },
      cardId: {
        type: "string",
        description: "The ID of the card to update",
      },
      name: { type: "string", description: "New title (optional)" },
      description: {
        type: "string",
        description: "New description (optional)",
      },
      dueDate: {
        type: "string",
        description: "New due date in ISO 8601 format (optional)",
      },
      listId: {
        type: "string",
        description: "Move card to this list ID (optional)",
      },
      listName: {
        type: "string",
        description: "Move card to this list by name (optional)",
      },
      labels: {
        type: "array",
        description: "Replace labels with these label IDs (optional)",
        items: { type: "string" },
      },
      labelNames: {
        type: "array",
        description:
          "Replace labels with these label names (optional — resolved via cache)",
        items: { type: "string" },
      },
    },
    required: ["cardId"],
  },
};

const trelloMoveCardTool: Tool = {
  name: "trello_move_card",
  description:
    "Moves a card to a different list. Provide listId or listName. Uses default board if boardId/boardName is omitted.",
  inputSchema: {
    type: "object",
    properties: {
      boardId: {
        type: "string",
        description: "Board ID (optional — uses default)",
      },
      boardName: {
        type: "string",
        description: "Board name (alternative to boardId)",
      },
      cardId: {
        type: "string",
        description: "The ID of the card to move",
      },
      listId: {
        type: "string",
        description: "The ID of the destination list",
      },
      listName: {
        type: "string",
        description: "Destination list name (alternative to listId)",
      },
    },
    required: ["cardId"],
  },
};

const trelloArchiveCardTool: Tool = {
  name: "trello_archive_card",
  description: "Archives (closes) a card.",
  inputSchema: {
    type: "object",
    properties: {
      cardId: {
        type: "string",
        description: "The ID of the card to archive",
      },
    },
    required: ["cardId"],
  },
};

// -- Comments ------------------------------------------------

const trelloAddCommentTool: Tool = {
  name: "trello_add_comment",
  description: "Adds a comment to a card.",
  inputSchema: {
    type: "object",
    properties: {
      cardId: {
        type: "string",
        description: "The ID of the card to comment on",
      },
      text: {
        type: "string",
        description: "The comment text",
      },
    },
    required: ["cardId", "text"],
  },
};

// -- Lists ---------------------------------------------------

const trelloGetListsTool: Tool = {
  name: "trello_get_lists",
  description:
    "Retrieves all lists on a board. Uses default board if boardId/boardName is omitted.",
  inputSchema: {
    type: "object",
    properties: {
      boardId: {
        type: "string",
        description: "Board ID (optional — uses default)",
      },
      boardName: {
        type: "string",
        description: "Board name (alternative to boardId)",
      },
    },
  },
};

const trelloAddListTool: Tool = {
  name: "trello_add_list",
  description:
    "Creates a new list on a board. Uses default board if boardId/boardName is omitted.",
  inputSchema: {
    type: "object",
    properties: {
      boardId: {
        type: "string",
        description: "Board ID (optional — uses default)",
      },
      boardName: {
        type: "string",
        description: "Board name (alternative to boardId)",
      },
      name: {
        type: "string",
        description: "Name of the new list",
      },
    },
    required: ["name"],
  },
};

const trelloArchiveListTool: Tool = {
  name: "trello_archive_list",
  description:
    "Archives (closes) a list. Provide listId or listName.",
  inputSchema: {
    type: "object",
    properties: {
      listId: {
        type: "string",
        description: "The ID of the list to archive",
      },
      listName: {
        type: "string",
        description: "List name (alternative to listId)",
      },
    },
  },
};

// -- Activity ------------------------------------------------

const trelloGetRecentActivityTool: Tool = {
  name: "trello_get_recent_activity",
  description:
    "Retrieves recent activity on a board. Uses default board if boardId/boardName is omitted.",
  inputSchema: {
    type: "object",
    properties: {
      boardId: {
        type: "string",
        description: "Board ID (optional — uses default)",
      },
      boardName: {
        type: "string",
        description: "Board name (alternative to boardId)",
      },
      limit: {
        type: "number",
        description: "Number of activities to retrieve (default: 10)",
      },
    },
  },
};

// -- Member cards & search -----------------------------------

const trelloGetMyCardsTool: Tool = {
  name: "trello_get_my_cards",
  description: "Retrieves all cards assigned to the authenticated user.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

const trelloSearchAllBoardsTool: Tool = {
  name: "trello_search_all_boards",
  description: "Cross-board search for cards, boards, and members.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search keyword" },
      limit: {
        type: "number",
        description: "Max results to retrieve (default: 10)",
      },
    },
    required: ["query"],
  },
};

const trelloSearchCardsTool: Tool = {
  name: "trello_search_cards",
  description:
    "Searches for cards within a specific board by name, description, or label. Uses default board if boardId/boardName is omitted.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search text" },
      boardId: {
        type: "string",
        description: "Board ID (optional — uses default board)",
      },
      boardName: {
        type: "string",
        description: "Board name (alternative to boardId)",
      },
      limit: {
        type: "number",
        description: "Max results (default: 10)",
      },
    },
    required: ["query"],
  },
};

// -- Card creator --------------------------------------------

const trelloGetCardCreatorTool: Tool = {
  name: "trello_get_card_creator",
  description:
    "Returns the full name and username of the Trello member who created a card. Useful for attributing changes in PRs or comments.",
  inputSchema: {
    type: "object",
    properties: {
      cardId: {
        type: "string",
        description: "The ID of the Trello card",
      },
    },
    required: ["cardId"],
  },
};

// -- Attachments ---------------------------------------------

const trelloGetCardAttachmentsTool: Tool = {
  name: "trello_get_card_attachments",
  description:
    "Lists all attachments on a card. Returns metadata including name, size, MIME type, and URL.",
  inputSchema: {
    type: "object",
    properties: {
      cardId: {
        type: "string",
        description: "The ID of the Trello card",
      },
    },
    required: ["cardId"],
  },
};

const trelloDownloadAttachmentTool: Tool = {
  name: "trello_download_attachment",
  description:
    "Downloads a specific attachment from a card. Images are returned as inline image content. Non-image files are saved to a temp directory and the file path is returned.",
  inputSchema: {
    type: "object",
    properties: {
      cardId: {
        type: "string",
        description: "The ID of the card",
      },
      attachmentId: {
        type: "string",
        description: "The ID of the attachment to download",
      },
    },
    required: ["cardId", "attachmentId"],
  },
};

// ============================================================
// All tools in registration order
// ============================================================

const ALL_TOOLS: Tool[] = [
  trelloGetMyBoardsTool,
  trelloSetDefaultBoardTool,
  trelloRefreshConfigTool,
  trelloGetConfigTool,
  trelloGetBoardLabelsTool,
  trelloGetCardsByListTool,
  trelloGetCardsByLabelTool,
  trelloAddCardTool,
  trelloUpdateCardTool,
  trelloMoveCardTool,
  trelloArchiveCardTool,
  trelloAddCommentTool,
  trelloGetListsTool,
  trelloAddListTool,
  trelloArchiveListTool,
  trelloGetRecentActivityTool,
  trelloGetMyCardsTool,
  trelloSearchAllBoardsTool,
  trelloSearchCardsTool,
  trelloGetCardCreatorTool,
  trelloGetCardAttachmentsTool,
  trelloDownloadAttachmentTool,
];

// ============================================================
// Tools that do NOT need a config to function
// ============================================================

const CONFIG_EXEMPT_TOOLS = new Set([
  "trello_get_my_boards",
  "trello_set_default_board",
  "trello_get_config",
  "trello_get_my_cards",
]);

// ============================================================
// Temp directory for attachment downloads
// ============================================================

const ATTACHMENT_DIR = join(tmpdir(), "trello-attachments");

function ensureAttachmentDir(): void {
  if (!existsSync(ATTACHMENT_DIR)) {
    mkdirSync(ATTACHMENT_DIR, { recursive: true });
  }
}

// ============================================================
// Server
// ============================================================

async function main() {
  const trelloApiKey = process.env.TRELLO_API_KEY;
  const trelloToken = process.env.TRELLO_TOKEN;

  if (!trelloApiKey || !trelloToken) {
    console.error(
      "Error: TRELLO_API_KEY and TRELLO_TOKEN environment variables are required."
    );
    console.error("Run the setup script or see README.md for instructions.");
    process.exit(1);
  }

  console.error("Starting Trello MCP Server (Enhanced)...");

  const server = new Server(
    { name: "trello-mcp-enhanced", version: "2.0.0" },
    { capabilities: { tools: {} } }
  );

  const trelloClient = new TrelloClient({
    apiKey: trelloApiKey,
    token: trelloToken,
  });

  // --------------------------------------------------------
  // Tool handler
  // --------------------------------------------------------
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      try {
        const args = (request.params.arguments ?? {}) as Record<
          string,
          unknown
        >;
        const toolName = request.params.name;

        // -- First-use config check (intercept) ----------------
        if (!CONFIG_EXEMPT_TOOLS.has(toolName)) {
          const setupResult = await ensureConfig(trelloClient);
          if (!setupResult.ready) {
            return {
              content: [
                { type: "text", text: setupResult.promptMessage ?? "" },
              ],
            };
          }
        }

        const config = loadConfig();

        switch (toolName) {
          // -- Boards ----------------------------------------
          case "trello_get_my_boards": {
            const boards = await trelloClient.getMyBoards();
            return {
              content: [{ type: "text", text: JSON.stringify(boards) }],
            };
          }

          // -- Config ----------------------------------------
          case "trello_set_default_board": {
            const boardId = args.boardId as string;
            if (!boardId)
              throw new Error("Missing required argument: boardId");

            // Fetch boards (used for name lookup + caching all boards)
            const boards = await trelloClient.getMyBoards();
            const board = boards.find((b) => b.id === boardId);
            const boardName = board?.name ?? "Unknown Board";

            const boardMap: Record<string, string> = {};
            for (const b of boards) {
              boardMap[b.name] = b.id;
            }

            const newConfig = await buildConfigForBoard(
              trelloClient,
              boardId,
              boardName,
              boardMap
            );

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    message: `Default board set to "${boardName}". Cached ${Object.keys(newConfig.labels).length} labels and ${Object.keys(newConfig.lists).length} lists.`,
                    config: newConfig,
                  }),
                },
              ],
            };
          }

          case "trello_refresh_config": {
            if (!config) {
              throw new Error(
                "No config exists yet. Call any tool to trigger setup, or use trello_set_default_board."
              );
            }
            // Preserve existing boardCache before rebuilding
            const existingBoardCache = config.boardCache;
            clearConfigCache();
            const refreshed = await buildConfigForBoard(
              trelloClient,
              config.defaultBoardId,
              config.defaultBoardName
            );
            // Restore boardCache (minus the default board, which was just refreshed)
            if (existingBoardCache) {
              const { [config.defaultBoardId]: _, ...rest } = existingBoardCache;
              if (Object.keys(rest).length > 0) {
                refreshed.boardCache = { ...refreshed.boardCache, ...rest };
                saveConfig(refreshed);
              }
            }
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    message: `Config refreshed for "${refreshed.defaultBoardName}". Cached ${Object.keys(refreshed.labels).length} labels and ${Object.keys(refreshed.lists).length} lists. ${Object.keys(refreshed.boardCache ?? {}).length} other board(s) preserved in cache.`,
                    config: refreshed,
                  }),
                },
              ],
            };
          }

          case "trello_get_config": {
            return {
              content: [
                {
                  type: "text",
                  text: config
                    ? JSON.stringify(config)
                    : JSON.stringify({ message: "No config exists yet. Call any tool to trigger setup." }),
                },
              ],
            };
          }

          // -- Labels ----------------------------------------
          case "trello_get_board_labels": {
            const boardId =
              resolveBoardId(args, config) ??
              (() => {
                throw new Error("No board ID available. Set a default board first.");
              })();
            if (config) await ensureBoardCached(config, trelloClient, boardId);
            const labels = await trelloClient.getBoardLabels(boardId);
            return {
              content: [{ type: "text", text: JSON.stringify(labels) }],
            };
          }

          // -- Cards -----------------------------------------
          case "trello_get_cards_by_list": {
            const boardId = resolveBoardId(args, config);
            if (!boardId)
              throw new Error("No board ID available for list name resolution.");
            const listId = await resolveListId(
              args,
              config,
              trelloClient,
              boardId
            );
            const cards = await trelloClient.getCardsByList(listId);
            return {
              content: [{ type: "text", text: JSON.stringify(cards) }],
            };
          }

          case "trello_get_cards_by_label": {
            const boardId = resolveBoardId(args, config);
            if (!boardId)
              throw new Error("No board ID available.");
            const labelId = await resolveLabelId(
              args,
              config,
              trelloClient,
              boardId
            );
            const cards = await trelloClient.getCardsByLabel(boardId, labelId);
            return {
              content: [{ type: "text", text: JSON.stringify(cards) }],
            };
          }

          case "trello_add_card": {
            const name = args.name as string;
            if (!name) throw new Error("Missing required argument: name");

            const boardId = resolveBoardId(args, config);
            if (!boardId)
              throw new Error("No board ID available for name resolution.");

            const listId = await resolveListId(
              args,
              config,
              trelloClient,
              boardId
            );
            const resolvedLabels = await resolveLabelIds(
              args,
              config,
              trelloClient,
              boardId
            );

            const card = await trelloClient.addCard({
              listId,
              name,
              description: args.description as string | undefined,
              dueDate: args.dueDate as string | undefined,
              labels: resolvedLabels,
            });
            return {
              content: [{ type: "text", text: JSON.stringify(card) }],
            };
          }

          case "trello_update_card": {
            const cardId = args.cardId as string;
            if (!cardId) throw new Error("Missing required argument: cardId");

            const boardId = resolveBoardId(args, config);

            // Resolve listName → listId if provided
            let listId = args.listId as string | undefined;
            if (!listId && args.listName && boardId) {
              listId = await resolveListId(
                args,
                config,
                trelloClient,
                boardId
              );
            }

            // Resolve labelNames → label IDs if provided
            let resolvedLabels = args.labels as string[] | undefined;
            if (!resolvedLabels && args.labelNames && boardId) {
              resolvedLabels = await resolveLabelIds(
                args,
                config,
                trelloClient,
                boardId
              );
            }

            const card = await trelloClient.updateCard({
              cardId,
              name: args.name as string | undefined,
              description: args.description as string | undefined,
              dueDate: args.dueDate as string | undefined,
              listId,
              labels: resolvedLabels,
            });
            return {
              content: [{ type: "text", text: JSON.stringify(card) }],
            };
          }

          case "trello_move_card": {
            const cardId = args.cardId as string;
            if (!cardId) throw new Error("Missing required argument: cardId");

            const boardId = resolveBoardId(args, config);
            if (!boardId)
              throw new Error("No board ID available for list resolution.");

            const listId = await resolveListId(
              args,
              config,
              trelloClient,
              boardId
            );
            const card = await trelloClient.moveCard(cardId, listId);
            return {
              content: [{ type: "text", text: JSON.stringify(card) }],
            };
          }

          case "trello_archive_card": {
            const cardId = args.cardId as string;
            if (!cardId) throw new Error("Missing required argument: cardId");
            const card = await trelloClient.archiveCard(cardId);
            return {
              content: [{ type: "text", text: JSON.stringify(card) }],
            };
          }

          // -- Comments --------------------------------------
          case "trello_add_comment": {
            const cardId = args.cardId as string;
            const text = args.text as string;
            if (!cardId || !text)
              throw new Error("Missing required arguments: cardId, text");
            const comment = await trelloClient.addComment(cardId, text);
            return {
              content: [{ type: "text", text: JSON.stringify(comment) }],
            };
          }

          // -- Lists -----------------------------------------
          case "trello_get_lists": {
            const boardId =
              resolveBoardId(args, config) ??
              (() => {
                throw new Error("No board ID available.");
              })();
            if (config) await ensureBoardCached(config, trelloClient, boardId);
            const lists = await trelloClient.getLists(boardId);
            return {
              content: [{ type: "text", text: JSON.stringify(lists) }],
            };
          }

          case "trello_add_list": {
            const boardId =
              resolveBoardId(args, config) ??
              (() => {
                throw new Error("No board ID available.");
              })();
            const name = args.name as string;
            if (!name) throw new Error("Missing required argument: name");
            const list = await trelloClient.addList(boardId, name);
            return {
              content: [{ type: "text", text: JSON.stringify(list) }],
            };
          }

          case "trello_archive_list": {
            const boardId = resolveBoardId(args, config);
            let listId = args.listId as string | undefined;

            if (!listId && args.listName) {
              if (!boardId)
                throw new Error("No board ID available for list name resolution.");
              listId = await resolveListId(
                args,
                config,
                trelloClient,
                boardId
              );
            }

            if (!listId)
              throw new Error("Either listId or listName is required.");
            const list = await trelloClient.archiveList(listId);
            return {
              content: [{ type: "text", text: JSON.stringify(list) }],
            };
          }

          // -- Activity --------------------------------------
          case "trello_get_recent_activity": {
            const boardId =
              resolveBoardId(args, config) ??
              (() => {
                throw new Error("No board ID available.");
              })();
            if (config) await ensureBoardCached(config, trelloClient, boardId);
            const limit = (args.limit as number) ?? 10;
            const activity = await trelloClient.getRecentActivity(
              boardId,
              limit
            );
            return {
              content: [{ type: "text", text: JSON.stringify(activity) }],
            };
          }

          // -- Member cards & search -------------------------
          case "trello_get_my_cards": {
            const cards = await trelloClient.getMyCards();
            return {
              content: [{ type: "text", text: JSON.stringify(cards) }],
            };
          }

          case "trello_search_all_boards": {
            const query = args.query as string;
            if (!query) throw new Error("Missing required argument: query");
            const limit = (args.limit as number) ?? 10;
            const results = await trelloClient.searchAllBoards(query, limit);
            return {
              content: [{ type: "text", text: JSON.stringify(results) }],
            };
          }

          case "trello_search_cards": {
            const query = args.query as string;
            if (!query) throw new Error("Missing required argument: query");
            const boardId =
              resolveBoardId(args, config) ??
              (() => {
                throw new Error("No board ID available.");
              })();
            if (config) await ensureBoardCached(config, trelloClient, boardId);
            const limit = (args.limit as number) ?? 10;
            const cards = await trelloClient.searchCards(
              boardId,
              query,
              limit
            );
            return {
              content: [{ type: "text", text: JSON.stringify(cards) }],
            };
          }

          // -- Card creator ----------------------------------
          case "trello_get_card_creator": {
            const cardId = args.cardId as string;
            if (!cardId) throw new Error("Missing required argument: cardId");
            const creator = await trelloClient.getCardCreator(cardId);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    creator ?? { fullName: "Unknown", username: "unknown" }
                  ),
                },
              ],
            };
          }

          // -- Attachments -----------------------------------
          case "trello_get_card_attachments": {
            const cardId = args.cardId as string;
            if (!cardId) throw new Error("Missing required argument: cardId");
            const attachments =
              await trelloClient.getCardAttachments(cardId);
            return {
              content: [{ type: "text", text: JSON.stringify(attachments) }],
            };
          }

          case "trello_download_attachment": {
            const cardId = args.cardId as string;
            const attachmentId = args.attachmentId as string;
            if (!cardId || !attachmentId)
              throw new Error(
                "Missing required arguments: cardId, attachmentId"
              );
            const result = await trelloClient.downloadAttachment(
              cardId,
              attachmentId
            );

            // External link — just return URL
            if (!result.content) {
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      name: result.attachment.name,
                      url: result.url,
                      error: result.error,
                    }),
                  },
                ],
              };
            }

            const mimeType = result.attachment.mimeType ?? "";

            // Images — return as inline image content block
            if (mimeType.startsWith("image/")) {
              return {
                content: [
                  {
                    type: "image" as const,
                    data: result.content,
                    mimeType,
                  },
                  {
                    type: "text",
                    text: JSON.stringify({
                      name: result.attachment.name,
                      mimeType,
                      bytes: result.attachment.bytes,
                    }),
                  },
                ],
              };
            }

            // Non-images — write to temp file, return path
            ensureAttachmentDir();
            const safeFileName = result.attachment.fileName.replace(
              /[^a-zA-Z0-9._-]/g,
              "_"
            );
            const filePath = join(ATTACHMENT_DIR, safeFileName);
            writeFileSync(filePath, Buffer.from(result.content, "base64"));

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    name: result.attachment.name,
                    mimeType,
                    bytes: result.attachment.bytes,
                    filePath,
                  }),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown tool: ${request.params.name}`);
        }
      } catch (error) {
        console.error("Error executing tool:", error);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error:
                  error instanceof Error ? error.message : String(error),
              }),
            },
          ],
        };
      }
    }
  );

  // --------------------------------------------------------
  // List tools handler
  // --------------------------------------------------------
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: ALL_TOOLS };
  });

  // --------------------------------------------------------
  // Start
  // --------------------------------------------------------
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Trello MCP Server (Enhanced) running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
