import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { TrelloClient } from "./trello-client.js";

// ============================================================
// Types
// ============================================================

export interface BoardCache {
  name: string;
  labels: Record<string, string>; // name (lowercase) → id
  lists: Record<string, string>; // name (lowercase) → id
}

export interface TrelloMcpConfig {
  defaultBoardId: string;
  defaultBoardName: string;
  boards: Record<string, string>; // name → id (all user boards)
  labels: Record<string, string>; // name (lowercase) → id  (default board)
  lists: Record<string, string>; // name (lowercase) → id  (default board)
  boardCache?: Record<string, BoardCache>; // boardId → cached data (non-default boards)
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
 * Returns the lists cache for a given board.
 * For the default board, uses top-level `lists`.
 * For other boards, uses `boardCache[boardId].lists`.
 */
function getListsCache(
  config: TrelloMcpConfig,
  boardId: string
): Record<string, string> {
  if (boardId === config.defaultBoardId) return config.lists;
  return config.boardCache?.[boardId]?.lists ?? {};
}

/**
 * Returns the labels cache for a given board.
 * For the default board, uses top-level `labels`.
 * For other boards, uses `boardCache[boardId].labels`.
 */
function getLabelsCache(
  config: TrelloMcpConfig,
  boardId: string
): Record<string, string> {
  if (boardId === config.defaultBoardId) return config.labels;
  return config.boardCache?.[boardId]?.labels ?? {};
}

/**
 * Ensures a non-default board has its lists and labels cached.
 * Fetches from API on first access, then persists to config.
 */
export async function ensureBoardCached(
  config: TrelloMcpConfig,
  client: TrelloClient,
  boardId: string
): Promise<void> {
  // Default board is always cached at the top level
  if (boardId === config.defaultBoardId) return;

  // Already cached
  if (config.boardCache?.[boardId]) return;

  const [labels, lists] = await Promise.all([
    client.getBoardLabels(boardId),
    client.getLists(boardId),
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

  // Derive a name from the boards map, or fall back
  const boardName =
    Object.entries(config.boards).find(([, id]) => id === boardId)?.[0] ??
    boardId;

  if (!config.boardCache) config.boardCache = {};
  config.boardCache[boardId] = { name: boardName, labels: labelMap, lists: listMap };
  saveConfig(config);
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

  // Ensure non-default board is cached before lookup
  if (config) {
    await ensureBoardCached(config, client, boardId);
  }

  // Try cache
  if (config) {
    const cached = getListsCache(config, boardId);
    if (cached[key]) return cached[key];
  }

  // Cache miss — re-fetch from API
  const lists = await client.getLists(boardId);
  const match = lists.find((l) => l.name.toLowerCase() === key);

  if (!match) {
    const available = lists.map((l) => l.name).join(", ");
    throw new Error(
      `No list found with name "${listName}". Available lists: ${available}`
    );
  }

  // Update the appropriate cache
  if (config) {
    if (boardId === config.defaultBoardId) {
      config.lists[key] = match.id;
    } else {
      if (!config.boardCache) config.boardCache = {};
      if (!config.boardCache[boardId]) {
        config.boardCache[boardId] = { name: boardId, labels: {}, lists: {} };
      }
      config.boardCache[boardId].lists[key] = match.id;
    }
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

  // Ensure non-default board is cached before lookup
  if (config) {
    await ensureBoardCached(config, client, boardId);
  }

  // Try cache
  if (config) {
    const cached = getLabelsCache(config, boardId);
    if (cached[key]) return cached[key];
  }

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

  // Update the appropriate cache
  if (config) {
    if (boardId === config.defaultBoardId) {
      config.labels[key] = match.id;
    } else {
      if (!config.boardCache) config.boardCache = {};
      if (!config.boardCache[boardId]) {
        config.boardCache[boardId] = { name: boardId, labels: {}, lists: {} };
      }
      config.boardCache[boardId].labels[key] = match.id;
    }
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
