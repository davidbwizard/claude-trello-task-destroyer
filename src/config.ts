import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { TrelloClient } from "./trello-client.js";

// ============================================================
// Types
// ============================================================

export interface TrelloMcpConfig {
  defaultBoardId: string;
  defaultBoardName: string;
  boards: Record<string, string>; // name → id (all user boards)
  labels: Record<string, string>; // name (lowercase) → id
  lists: Record<string, string>; // name (lowercase) → id
}

// ============================================================
// Config file path — lives next to package.json (project root)
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_PATH = join(__dirname, "..", "trello-config.json");

// ============================================================
// Load / Save
// ============================================================

let cachedConfig: TrelloMcpConfig | null = null;

export function loadConfig(): TrelloMcpConfig | null {
  if (cachedConfig) return cachedConfig;
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    cachedConfig = JSON.parse(raw) as TrelloMcpConfig;
    return cachedConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: TrelloMcpConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
  cachedConfig = config;
}

/** Force reload from disk (used after refresh). */
export function clearConfigCache(): void {
  cachedConfig = null;
}

// ============================================================
// First-use flow — board selection + cascade
// ============================================================

export interface ConfigSetupResult {
  /** If true, the config is ready and the original tool call can proceed. */
  ready: boolean;
  /** If ready is false, this message should be returned to the user. */
  promptMessage?: string;
  config?: TrelloMcpConfig;
}

/**
 * Ensures config exists. If not, fetches boards and either auto-selects
 * (single board) or prompts the user to pick one.
 */
export async function ensureConfig(
  client: TrelloClient
): Promise<ConfigSetupResult> {
  const existing = loadConfig();
  if (existing) return { ready: true, config: existing };

  // No config — fetch boards
  const boards = await client.getMyBoards();

  if (boards.length === 0) {
    return {
      ready: false,
      promptMessage:
        "No Trello boards found for this account. Create a board on Trello first, then try again.",
    };
  }

  // Cache all boards for quick reference
  const boardMap = buildBoardMap(boards);

  if (boards.length === 1) {
    // Auto-select the only board
    const board = boards[0];
    const config = await buildConfigForBoard(client, board.id, board.name, boardMap);
    console.error(`Auto-selected board: "${board.name}" (${board.id})`);
    return { ready: true, config };
  }

  // Multiple boards — ask the user to pick
  const boardList = boards
    .map((b) => `  • ${b.name} — ID: ${b.id}`)
    .join("\n");

  return {
    ready: false,
    promptMessage: [
      "Multiple Trello boards found. Please select a default board by calling `trello_set_default_board` with the board ID:\n",
      boardList,
    ].join("\n"),
  };
}

/**
 * Converts a boards array into a name → id map for caching.
 */
function buildBoardMap(
  boards: { id: string; name: string }[]
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const b of boards) {
    map[b.name] = b.id;
  }
  return map;
}

/**
 * Builds a complete config for a given board: fetches labels + lists
 * and writes the config file.
 *
 * If `boards` map is provided it's used directly; otherwise boards
 * are fetched from the API so the cache stays current.
 */
export async function buildConfigForBoard(
  client: TrelloClient,
  boardId: string,
  boardName: string,
  boards?: Record<string, string>
): Promise<TrelloMcpConfig> {
  const [labels, lists, boardMap] = await Promise.all([
    client.getBoardLabels(boardId),
    client.getLists(boardId),
    boards
      ? Promise.resolve(boards)
      : client.getMyBoards().then(buildBoardMap),
  ]);

  const labelMap: Record<string, string> = {};
  for (const label of labels) {
    if (label.name) {
      labelMap[label.name.toLowerCase()] = label.id;
    }
  }

  const listMap: Record<string, string> = {};
  for (const list of lists) {
    if (list.name) {
      listMap[list.name.toLowerCase()] = list.id;
    }
  }

  const config: TrelloMcpConfig = {
    defaultBoardId: boardId,
    defaultBoardName: boardName,
    boards: boardMap,
    labels: labelMap,
    lists: listMap,
  };

  saveConfig(config);
  return config;
}

// ============================================================
// Resolution helpers
// ============================================================

/**
 * Resolves a board ID from args or config.
 * Returns null if neither is available (caller should trigger first-use flow).
 */
export function resolveBoardId(
  args: Record<string, unknown>,
  config: TrelloMcpConfig | null
): string | null {
  if (args.boardId && typeof args.boardId === "string") return args.boardId;
  if (config?.defaultBoardId) return config.defaultBoardId;
  return null;
}

/**
 * Resolves a list ID from `listId` or `listName`.
 * On cache miss for a name, re-fetches lists from API and updates config.
 */
export async function resolveListId(
  args: Record<string, unknown>,
  config: TrelloMcpConfig | null,
  client: TrelloClient,
  boardId: string
): Promise<string> {
  // Direct ID always wins
  if (args.listId && typeof args.listId === "string") return args.listId;

  const listName = args.listName as string | undefined;
  if (!listName) {
    throw new Error(
      "Either listId or listName is required."
    );
  }

  const key = listName.toLowerCase();

  // Try cache first
  if (config?.lists[key]) return config.lists[key];

  // Cache miss — re-fetch from API
  const lists = await client.getLists(boardId);
  const match = lists.find((l) => l.name.toLowerCase() === key);

  if (!match) {
    const available = lists.map((l) => l.name).join(", ");
    throw new Error(
      `No list found with name "${listName}". Available lists: ${available}`
    );
  }

  // Update cache
  if (config) {
    config.lists[key] = match.id;
    saveConfig(config);
  }

  return match.id;
}

/**
 * Resolves a label ID from `labelId` or `labelName`.
 * On cache miss for a name, re-fetches labels from API and updates config.
 */
export async function resolveLabelId(
  args: Record<string, unknown>,
  config: TrelloMcpConfig | null,
  client: TrelloClient,
  boardId: string
): Promise<string> {
  if (args.labelId && typeof args.labelId === "string") return args.labelId;

  const labelName = args.labelName as string | undefined;
  if (!labelName) {
    throw new Error(
      "Either labelId or labelName is required."
    );
  }

  const key = labelName.toLowerCase();

  if (config?.labels[key]) return config.labels[key];

  // Cache miss — re-fetch
  const labels = await client.getBoardLabels(boardId);
  const match = labels.find((l) => l.name.toLowerCase() === key);

  if (!match) {
    const available = labels
      .filter((l) => l.name)
      .map((l) => l.name)
      .join(", ");
    throw new Error(
      `No label found with name "${labelName}". Available labels: ${available}`
    );
  }

  if (config) {
    config.labels[key] = match.id;
    saveConfig(config);
  }

  return match.id;
}

/**
 * Resolves an array of label IDs from `labels` (IDs) or `labelNames` (names).
 */
export async function resolveLabelIds(
  args: Record<string, unknown>,
  config: TrelloMcpConfig | null,
  client: TrelloClient,
  boardId: string
): Promise<string[] | undefined> {
  // Direct IDs
  if (args.labels && Array.isArray(args.labels)) {
    return args.labels as string[];
  }

  const labelNames = args.labelNames as string[] | undefined;
  if (!labelNames || labelNames.length === 0) return undefined;

  const ids: string[] = [];
  for (const name of labelNames) {
    const id = await resolveLabelId(
      { labelName: name },
      config,
      client,
      boardId
    );
    ids.push(id);
  }
  return ids;
}
