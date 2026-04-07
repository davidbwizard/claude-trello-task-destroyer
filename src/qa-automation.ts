import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { TrelloClient } from "./trello-client.js";
import {
  QAAutomationConfig,
  QARepoConfig,
  CardClassification,
  AutoResult,
  PendingCard,
  PRUpdate,
  PendingWork,
  TrelloCard,
} from "./types.js";

// ============================================================
// In-memory cache of pending work
// ============================================================

let pendingWorkCache: PendingWork = {
  cards: [],
  prUpdates: [],
  summary: "No poll has run yet.",
  lastPollTime: null,
};

let pollingInterval: ReturnType<typeof setInterval> | null = null;

// ============================================================
// Public API
// ============================================================

export function getPendingWork(): PendingWork {
  return pendingWorkCache;
}

export function startQAPolling(
  client: TrelloClient,
  config: QAAutomationConfig
): void {
  if (pollingInterval) {
    console.error("QA polling already running — skipping duplicate start.");
    return;
  }

  const intervalMs = config.pollIntervalMinutes * 60 * 1000;
  console.error(
    `QA Automation: polling every ${config.pollIntervalMinutes}m (watchList: ${config.watchListId})`
  );

  // Run immediately on start, then on interval
  runPollCycle(client, config).catch((err) =>
    console.error("QA poll cycle error:", err)
  );

  pollingInterval = setInterval(() => {
    runPollCycle(client, config).catch((err) =>
      console.error("QA poll cycle error:", err)
    );
  }, intervalMs);
}

export function stopQAPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.error("QA Automation: polling stopped.");
  }
}

// ============================================================
// Poll cycle — runs every N minutes
// ============================================================

async function runPollCycle(
  client: TrelloClient,
  config: QAAutomationConfig
): Promise<void> {
  console.error("QA poll cycle starting...");
  const cards: PendingCard[] = [];
  const prUpdates: PRUpdate[] = [];

  try {
    // Phase 1: Check watch list for cards
    const trelloCards = await client.getCardsByList(config.watchListId);

    if (trelloCards.length > 0) {
      // Process oldest card first (Trello returns newest first by default)
      const sorted = [...trelloCards].sort(
        (a, b) =>
          new Date(a.dateLastActivity).getTime() -
          new Date(b.dateLastActivity).getTime()
      );

      // Process only one card per cycle to limit blast radius
      const card = sorted[0];
      const processed = await processCard(client, config, card);
      cards.push(processed);

      // Queue remaining cards as unprocessed
      for (let i = 1; i < sorted.length; i++) {
        cards.push({
          id: sorted[i].id,
          shortId: extractShortId(sorted[i]),
          title: sorted[i].name,
          description: sorted[i].desc,
          author: await getCardAuthor(client, sorted[i].id),
          url: sorted[i].url,
          classification: "complex", // not yet classified
          autoResult: null,
        });
      }
    }

    // Phase 2: Check PR statuses
    for (const repo of config.repos) {
      const merged = await checkPRs(client, config, repo, "merged");
      const closed = await checkPRs(client, config, repo, "closed");
      prUpdates.push(...merged, ...closed);
    }
  } catch (err) {
    console.error("QA poll cycle error:", err);
  }

  // Build summary
  const cardSummary = cards.length > 0
    ? `${cards.length} card(s) in queue`
    : "No cards";
  const autoSuccess = cards.filter(
    (c) => c.autoResult?.status === "success"
  ).length;
  const autoError = cards.filter(
    (c) => c.autoResult?.status === "error"
  ).length;
  const prSummary = prUpdates.length > 0
    ? `${prUpdates.length} PR update(s)`
    : "No PR updates";

  let summary = cardSummary;
  if (autoSuccess > 0) summary += ` (${autoSuccess} auto-completed)`;
  if (autoError > 0) summary += ` (${autoError} auto-failed)`;
  summary += `. ${prSummary}.`;

  pendingWorkCache = {
    cards,
    prUpdates,
    summary,
    lastPollTime: new Date().toISOString(),
  };

  console.error(`QA poll cycle complete: ${summary}`);
}

// ============================================================
// Card processing
// ============================================================

async function processCard(
  client: TrelloClient,
  config: QAAutomationConfig,
  card: TrelloCard
): Promise<PendingCard> {
  const shortId = extractShortId(card);
  const author = await getCardAuthor(client, card.id);
  const classification = classifyCard(config, card.desc);

  const pending: PendingCard = {
    id: card.id,
    shortId,
    title: card.name,
    description: card.desc,
    author,
    url: card.url,
    classification,
    autoResult: null,
  };

  // Out of scope → move to Inbox with comment
  if (classification === "out_of_scope") {
    const reason = getOutOfScopeReason(config, card.desc);
    try {
      await client.moveCard(card.id, config.inboxListId);
      await client.addComment(
        card.id,
        `This card was moved back to Inbox automatically.\n\n**Reason**: ${reason}\n\nThis type of change requires human review.`
      );
      pending.autoResult = {
        status: "success",
        message: `Moved to Inbox: ${reason}`,
      };
    } catch (err) {
      pending.autoResult = {
        status: "error",
        message: `Failed to move out-of-scope card: ${err}`,
      };
    }
    return pending;
  }

  // Unparseable → leave for Claude
  if (classification === "unparseable") {
    pending.autoResult = {
      status: "error",
      message: "Card description could not be parsed. Needs AI review.",
    };
    return pending;
  }

  // Simple text → attempt auto-fix
  if (classification === "simple_text") {
    const result = await attemptSimpleTextChange(client, config, card, shortId);
    pending.autoResult = result;
    return pending;
  }

  // Complex → leave for Claude (no auto-action)
  return pending;
}

// ============================================================
// Classification
// ============================================================

function classifyCard(
  config: QAAutomationConfig,
  description: string
): CardClassification {
  const lower = description.toLowerCase();

  // Check out-of-scope keywords
  for (const keyword of config.outOfScopeKeywords) {
    if (lower.includes(keyword.toLowerCase())) {
      return "out_of_scope";
    }
  }

  // Check out-of-scope file patterns
  for (const pattern of config.outOfScopePatterns) {
    if (lower.includes(pattern.toLowerCase())) {
      return "out_of_scope";
    }
  }

  // Try to parse structured text change format
  const parsed = parseTextChange(description);
  if (parsed) {
    return "simple_text";
  }

  // Has description but not structured → complex (needs AI judgment)
  if (description.trim().length > 0) {
    return "complex";
  }

  return "unparseable";
}

function getOutOfScopeReason(
  config: QAAutomationConfig,
  description: string
): string {
  const lower = description.toLowerCase();

  for (const keyword of config.outOfScopeKeywords) {
    if (lower.includes(keyword.toLowerCase())) {
      return `Contains out-of-scope keyword: "${keyword}"`;
    }
  }

  for (const pattern of config.outOfScopePatterns) {
    if (lower.includes(pattern.toLowerCase())) {
      return `References out-of-scope file pattern: "${pattern}"`;
    }
  }

  return "Change classified as out of scope.";
}

// ============================================================
// Text change parsing
// ============================================================

interface ParsedTextChange {
  currentText: string;
  newText: string;
}

function parseTextChange(description: string): ParsedTextChange | null {
  // Match ## Current Text and ## New Text sections
  const currentMatch = description.match(
    /##\s*Current\s*Text\s*\n([\s\S]*?)(?=\n##\s*New\s*Text|$)/i
  );
  const newMatch = description.match(
    /##\s*New\s*Text\s*\n([\s\S]*?)$/i
  );

  if (!currentMatch || !newMatch) return null;

  const currentText = currentMatch[1].trim();
  const newText = newMatch[1].trim();

  if (!currentText || !newText) return null;
  if (currentText === newText) return null;

  return { currentText, newText };
}

// ============================================================
// Simple text change automation
// ============================================================

async function attemptSimpleTextChange(
  client: TrelloClient,
  config: QAAutomationConfig,
  card: TrelloCard,
  shortId: string
): Promise<AutoResult> {
  const parsed = parseTextChange(card.desc);
  if (!parsed) {
    return { status: "error", message: "Failed to parse text change from card." };
  }

  const { currentText, newText } = parsed;

  // Grep for the current text in the project
  let grepResult: string;
  try {
    grepResult = execSync(
      `grep -rl --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.css" --include="*.html" --include="*.json" ${shellEscape(currentText)} ${shellEscape(config.projectRoot)}`,
      { encoding: "utf-8", timeout: 10000 }
    ).trim();
  } catch {
    // grep returns exit 1 when no matches found
    return {
      status: "error",
      message: `Text "${truncate(currentText, 50)}" not found in project.`,
    };
  }

  const matchingFiles = grepResult.split("\n").filter(Boolean);

  if (matchingFiles.length === 0) {
    return {
      status: "error",
      message: `Text "${truncate(currentText, 50)}" not found in project.`,
    };
  }

  if (matchingFiles.length > 1) {
    return {
      status: "error",
      message: `Text appears in ${matchingFiles.length} files — ambiguous. Files: ${matchingFiles.join(", ")}`,
    };
  }

  const filePath = matchingFiles[0];

  // Verify text appears exactly once in the file
  const fileContent = readFileSync(filePath, "utf-8");
  const occurrences = fileContent.split(currentText).length - 1;

  if (occurrences === 0) {
    return {
      status: "error",
      message: `Text not found in ${filePath} (grep matched but exact match failed).`,
    };
  }

  if (occurrences > 1) {
    return {
      status: "error",
      message: `Text appears ${occurrences} times in ${filePath} — ambiguous.`,
    };
  }

  // Make the replacement
  const updatedContent = fileContent.replace(currentText, newText);
  writeFileSync(filePath, updatedContent, "utf-8");

  // Verify the replacement
  const verifyContent = readFileSync(filePath, "utf-8");
  if (!verifyContent.includes(newText)) {
    // Revert
    writeFileSync(filePath, fileContent, "utf-8");
    return {
      status: "error",
      message: "Replacement failed verification — file reverted.",
    };
  }

  // Determine which repo this file belongs to
  const repo = determineRepo(config, filePath);
  if (!repo) {
    // Revert
    writeFileSync(filePath, fileContent, "utf-8");
    return {
      status: "error",
      message: `Could not determine repo for file: ${filePath}`,
    };
  }

  // Run shipit-auto.sh --direct
  const shipitPath = join(config.projectRoot, config.shipitScript);
  const commitMsg = `QA: ${card.name} [${shortId}]`;

  try {
    const output = execSync(
      `${shellEscape(shipitPath)} --direct ${shellEscape(repo.name)} ${shellEscape(shortId)} ${shellEscape(commitMsg)}`,
      {
        encoding: "utf-8",
        timeout: 30000,
        cwd: config.projectRoot,
      }
    );

    // Parse commit hash from output
    const commitMatch = output.match(/COMMIT:\s*(\S+)/);
    const commit = commitMatch?.[1] ?? "unknown";

    // Move card to Ready for QA
    await client.moveCard(card.id, config.readyForQAListId);
    await client.addComment(
      card.id,
      `Direct push completed automatically.\n\n**Commit**: \`${commit}\`\n**Branch**: \`${repo.deployBranch}\`\n**File**: \`${filePath.replace(config.projectRoot + "/", "")}\`\n**Change**: "${truncate(currentText, 40)}" → "${truncate(newText, 40)}"`
    );

    return {
      status: "success",
      commit,
      file: filePath.replace(config.projectRoot + "/", ""),
    };
  } catch (err) {
    // Revert the file change
    writeFileSync(filePath, fileContent, "utf-8");

    // Also try to revert any staged changes
    try {
      execSync(`git -C ${shellEscape(config.projectRoot)} checkout -- .`, {
        timeout: 5000,
      });
    } catch {
      // Best effort
    }

    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      message: `shipit-auto.sh failed: ${truncate(errMsg, 200)}`,
      file: filePath.replace(config.projectRoot + "/", ""),
    };
  }
}

// ============================================================
// PR monitoring
// ============================================================

async function checkPRs(
  client: TrelloClient,
  config: QAAutomationConfig,
  repo: QARepoConfig,
  state: "merged" | "closed"
): Promise<PRUpdate[]> {
  const updates: PRUpdate[] = [];

  try {
    const output = execSync(
      `gh pr list -R ${shellEscape(repo.ghSlug)} --search "head:qa/" --state ${state} --json number,url,body --limit 20`,
      { encoding: "utf-8", timeout: 15000 }
    );

    const prs = JSON.parse(output) as Array<{
      number: number;
      url: string;
      body: string;
    }>;

    for (const pr of prs) {
      const cardUrl = extractTrelloCardUrl(pr.body);
      let handled = false;
      let comment: string | null = null;

      if (cardUrl) {
        const cardId = extractCardIdFromUrl(cardUrl);

        if (cardId) {
          try {
            if (state === "merged") {
              await client.moveCard(cardId, config.readyForQAListId);
              await client.addComment(
                cardId,
                `PR merged and deployed to dev.\n\n**PR**: ${pr.url}`
              );
              comment = `PR merged — card moved to Ready for QA`;
              handled = true;

              // Try to delete remote branch
              try {
                const branchMatch = pr.url.match(/\/pull\/\d+/);
                if (branchMatch) {
                  execSync(
                    `gh pr view -R ${shellEscape(repo.ghSlug)} ${pr.number} --json headRefName --jq .headRefName`,
                    { encoding: "utf-8", timeout: 10000 }
                  );
                }
              } catch {
                // Best effort branch cleanup
              }
            } else {
              // Closed (not merged)
              let closeReason = "No reason provided.";
              try {
                const commentsOutput = execSync(
                  `gh pr view -R ${shellEscape(repo.ghSlug)} ${pr.number} --json comments --jq '.comments[-1].body'`,
                  { encoding: "utf-8", timeout: 10000 }
                ).trim();
                if (commentsOutput) closeReason = commentsOutput;
              } catch {
                // Use default reason
              }

              await client.moveCard(cardId, config.inboxListId);
              await client.addComment(
                cardId,
                `PR closed without merging. Card returned to Inbox.\n\n**PR**: ${pr.url}\n**Reason**: ${closeReason}`
              );
              comment = `PR closed — card moved to Inbox: ${truncate(closeReason, 100)}`;
              handled = true;
            }
          } catch (err) {
            comment = `Failed to update Trello card: ${err}`;
            handled = false;
          }
        }
      }

      updates.push({
        repo: repo.name,
        prNumber: pr.number,
        prUrl: pr.url,
        state,
        cardUrl,
        handled,
        comment,
      });
    }
  } catch (err) {
    // gh command failed — likely no PRs or gh not available
    const errMsg = err instanceof Error ? err.message : String(err);
    if (!errMsg.includes("no pull requests match")) {
      console.error(`PR check failed for ${repo.ghSlug} (${state}):`, errMsg);
    }
  }

  return updates;
}

// ============================================================
// Helpers
// ============================================================

function extractShortId(card: TrelloCard): string {
  // Trello card URLs end with /c/{shortLink}/{name}
  const match = card.url.match(/\/c\/([^/]+)/);
  return match?.[1] ?? card.id.slice(-6);
}

async function getCardAuthor(
  client: TrelloClient,
  cardId: string
): Promise<string> {
  try {
    const creator = await client.getCardCreator(cardId);
    return creator?.fullName ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

function determineRepo(
  config: QAAutomationConfig,
  filePath: string
): QARepoConfig | null {
  const relativePath = filePath.replace(config.projectRoot + "/", "");

  // Check if file is in a subdir repo
  for (const repo of config.repos) {
    if (repo.subdir && repo.pathPrefix && relativePath.startsWith(repo.pathPrefix + "/")) {
      return repo;
    }
  }

  // Default to the root repo (no pathPrefix or empty pathPrefix)
  for (const repo of config.repos) {
    if (!repo.pathPrefix || repo.pathPrefix === "") {
      return repo;
    }
  }

  return config.repos[0] ?? null;
}

function extractTrelloCardUrl(prBody: string): string | null {
  const match = prBody.match(/https:\/\/trello\.com\/c\/[^\s)]+/);
  return match?.[0] ?? null;
}

function extractCardIdFromUrl(url: string): string | null {
  // Trello card URLs: https://trello.com/c/{shortLink}/{slug}
  // We need the full card ID, but shortLink works for API calls too
  const match = url.match(/\/c\/([^/]+)/);
  return match?.[1] ?? null;
}

function shellEscape(str: string): string {
  // Wrap in single quotes, escaping any internal single quotes
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}
