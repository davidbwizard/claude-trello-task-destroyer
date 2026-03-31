#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequest,
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { TrelloClient } from "./trello-client.js";

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

// -- Labels --------------------------------------------------

const trelloGetBoardLabelsTool: Tool = {
  name: "trello_get_board_labels",
  description:
    "Retrieves all labels defined on a board. Use this to discover available labels before filtering cards. Labels like 'Bug' and 'Feature Request' are primary filters; others (e.g. 'Onboarding', 'Kid') provide context about the affected area or audience.",
  inputSchema: {
    type: "object",
    properties: {
      boardId: {
        type: "string",
        description: "The ID of the Trello board",
      },
    },
    required: ["boardId"],
  },
};

// -- Cards ---------------------------------------------------

const trelloGetCardsByListTool: Tool = {
  name: "trello_get_cards_by_list",
  description:
    "Retrieves all cards in a specific list. Cards include their labels for context.",
  inputSchema: {
    type: "object",
    properties: {
      listId: {
        type: "string",
        description: "Trello list ID",
      },
    },
    required: ["listId"],
  },
};

const trelloGetCardsByLabelTool: Tool = {
  name: "trello_get_cards_by_label",
  description:
    "Retrieves all open cards on a board that have a specific label. Great for filtering by category like 'Bug' or 'Feature Request'. Use trello_get_board_labels first to get label IDs.",
  inputSchema: {
    type: "object",
    properties: {
      boardId: {
        type: "string",
        description: "The ID of the Trello board",
      },
      labelId: {
        type: "string",
        description:
          "The ID of the label to filter by (get this from trello_get_board_labels)",
      },
    },
    required: ["boardId", "labelId"],
  },
};

const trelloAddCardTool: Tool = {
  name: "trello_add_card",
  description: "Creates a new card in a specified list.",
  inputSchema: {
    type: "object",
    properties: {
      listId: {
        type: "string",
        description: "The ID of the list to add the card to",
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
    },
    required: ["listId", "name"],
  },
};

const trelloUpdateCardTool: Tool = {
  name: "trello_update_card",
  description:
    "Updates a card's properties: name, description, due date, labels, or list.",
  inputSchema: {
    type: "object",
    properties: {
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
      labels: {
        type: "array",
        description: "Replace labels with these label IDs (optional)",
        items: { type: "string" },
      },
    },
    required: ["cardId"],
  },
};

const trelloMoveCardTool: Tool = {
  name: "trello_move_card",
  description:
    "Moves a card to a different list. Use this when a task changes status (e.g. Inbox → In Progress → Complete).",
  inputSchema: {
    type: "object",
    properties: {
      cardId: {
        type: "string",
        description: "The ID of the card to move",
      },
      listId: {
        type: "string",
        description: "The ID of the destination list",
      },
    },
    required: ["cardId", "listId"],
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
  description: "Retrieves all lists on a board.",
  inputSchema: {
    type: "object",
    properties: {
      boardId: {
        type: "string",
        description: "The ID of the Trello board",
      },
    },
    required: ["boardId"],
  },
};

const trelloAddListTool: Tool = {
  name: "trello_add_list",
  description: "Creates a new list on a board.",
  inputSchema: {
    type: "object",
    properties: {
      boardId: {
        type: "string",
        description: "The ID of the board",
      },
      name: {
        type: "string",
        description: "Name of the new list",
      },
    },
    required: ["boardId", "name"],
  },
};

const trelloArchiveListTool: Tool = {
  name: "trello_archive_list",
  description: "Archives (closes) a list.",
  inputSchema: {
    type: "object",
    properties: {
      listId: {
        type: "string",
        description: "The ID of the list to archive",
      },
    },
    required: ["listId"],
  },
};

// -- Activity ------------------------------------------------

const trelloGetRecentActivityTool: Tool = {
  name: "trello_get_recent_activity",
  description: "Retrieves recent activity on a board.",
  inputSchema: {
    type: "object",
    properties: {
      boardId: {
        type: "string",
        description: "The ID of the Trello board",
      },
      limit: {
        type: "number",
        description: "Number of activities to retrieve (default: 10)",
      },
    },
    required: ["boardId"],
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
    "Downloads a specific attachment from a card. Returns base64 content for Trello uploads, or URL for external links.",
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
  trelloGetCardAttachmentsTool,
  trelloDownloadAttachmentTool,
];

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
    { name: "trello-mcp-enhanced", version: "1.0.0" },
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
        const args = (request.params.arguments ?? {}) as Record<string, unknown>;

        switch (request.params.name) {
          // -- Boards ----------------------------------------
          case "trello_get_my_boards": {
            const boards = await trelloClient.getMyBoards();
            return {
              content: [{ type: "text", text: JSON.stringify(boards) }],
            };
          }

          // -- Labels ----------------------------------------
          case "trello_get_board_labels": {
            const boardId = args.boardId as string;
            if (!boardId) throw new Error("Missing required argument: boardId");
            const labels = await trelloClient.getBoardLabels(boardId);
            return {
              content: [{ type: "text", text: JSON.stringify(labels) }],
            };
          }

          // -- Cards -----------------------------------------
          case "trello_get_cards_by_list": {
            const listId = args.listId as string;
            if (!listId) throw new Error("Missing required argument: listId");
            const cards = await trelloClient.getCardsByList(listId);
            return {
              content: [{ type: "text", text: JSON.stringify(cards) }],
            };
          }

          case "trello_get_cards_by_label": {
            const boardId = args.boardId as string;
            const labelId = args.labelId as string;
            if (!boardId || !labelId)
              throw new Error(
                "Missing required arguments: boardId, labelId"
              );
            const cards = await trelloClient.getCardsByLabel(boardId, labelId);
            return {
              content: [{ type: "text", text: JSON.stringify(cards) }],
            };
          }

          case "trello_add_card": {
            const listId = args.listId as string;
            const name = args.name as string;
            if (!listId || !name)
              throw new Error("Missing required arguments: listId, name");
            const card = await trelloClient.addCard({
              listId,
              name,
              description: args.description as string | undefined,
              dueDate: args.dueDate as string | undefined,
              labels: args.labels as string[] | undefined,
            });
            return {
              content: [{ type: "text", text: JSON.stringify(card) }],
            };
          }

          case "trello_update_card": {
            const cardId = args.cardId as string;
            if (!cardId) throw new Error("Missing required argument: cardId");
            const card = await trelloClient.updateCard({
              cardId,
              name: args.name as string | undefined,
              description: args.description as string | undefined,
              dueDate: args.dueDate as string | undefined,
              listId: args.listId as string | undefined,
              labels: args.labels as string[] | undefined,
            });
            return {
              content: [{ type: "text", text: JSON.stringify(card) }],
            };
          }

          case "trello_move_card": {
            const cardId = args.cardId as string;
            const listId = args.listId as string;
            if (!cardId || !listId)
              throw new Error("Missing required arguments: cardId, listId");
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
            const boardId = args.boardId as string;
            if (!boardId) throw new Error("Missing required argument: boardId");
            const lists = await trelloClient.getLists(boardId);
            return {
              content: [{ type: "text", text: JSON.stringify(lists) }],
            };
          }

          case "trello_add_list": {
            const boardId = args.boardId as string;
            const name = args.name as string;
            if (!boardId || !name)
              throw new Error("Missing required arguments: boardId, name");
            const list = await trelloClient.addList(boardId, name);
            return {
              content: [{ type: "text", text: JSON.stringify(list) }],
            };
          }

          case "trello_archive_list": {
            const listId = args.listId as string;
            if (!listId) throw new Error("Missing required argument: listId");
            const list = await trelloClient.archiveList(listId);
            return {
              content: [{ type: "text", text: JSON.stringify(list) }],
            };
          }

          // -- Activity --------------------------------------
          case "trello_get_recent_activity": {
            const boardId = args.boardId as string;
            if (!boardId) throw new Error("Missing required argument: boardId");
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
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
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
