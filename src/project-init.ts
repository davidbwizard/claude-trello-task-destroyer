import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadConfig, saveConfig } from "./config.js";
import { QARepoConfig } from "./types.js";

// ============================================================
// Types
// ============================================================

export interface InitProjectParams {
  projectRoot: string;
  watchListId: string;
  inboxListId: string;
  inProgressListId: string;
  readyForQAListId: string;
  repos: Array<{
    name: string;
    ghSlug: string;
    deployBranch: string;
    pathPrefix: string;
  }>;
  shipitScript?: string;
  pollIntervalMinutes?: number;
  maxFilesPerCard?: number;
  outOfScopePatterns?: string[];
  outOfScopeKeywords?: string[];
  overwrite?: boolean;
}

export interface InitProjectResult {
  success: boolean;
  filesCreated: string[];
  filesSkipped: string[];
  loopCommand: string;
  message: string;
}

// ============================================================
// Template directory
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATE_DIR = join(__dirname, "..", "templates");

// ============================================================
// Main function
// ============================================================

export async function initProject(
  params: InitProjectParams,
  listNameResolver: (id: string) => string | null
): Promise<InitProjectResult> {
  const {
    projectRoot,
    watchListId,
    inboxListId,
    inProgressListId,
    readyForQAListId,
    repos,
    shipitScript = "shipit-auto.sh",
    pollIntervalMinutes = 10,
    maxFilesPerCard = 15,
    outOfScopePatterns = ["routes/", "middleware/", "migrations/"],
    outOfScopeKeywords = [
      "add component",
      "new endpoint",
      "migration",
      "auth",
      "database",
      "schema",
    ],
    overwrite = false,
  } = params;

  // Validate project root
  if (!existsSync(projectRoot)) {
    return {
      success: false,
      filesCreated: [],
      filesSkipped: [],
      loopCommand: "",
      message: `Project root does not exist: ${projectRoot}`,
    };
  }

  // Check for existing files
  const trelloDir = join(projectRoot, ".trello");
  const yamlPath = join(trelloDir, "trello-loop-config.yaml");
  const mdPath = join(trelloDir, "trello-loop.md");
  const existingFiles: string[] = [];

  if (existsSync(yamlPath)) existingFiles.push("trello-loop-config.yaml");
  if (existsSync(mdPath)) existingFiles.push("docs/trello-loop.md");

  if (existingFiles.length > 0 && !overwrite) {
    return {
      success: false,
      filesCreated: [],
      filesSkipped: existingFiles,
      loopCommand: "",
      message: `Files already exist: ${existingFiles.join(", ")}. Set overwrite: true to replace them.`,
    };
  }

  // Resolve list names from IDs
  const watchListName = listNameResolver(watchListId) ?? "Watch List";
  const inboxListName = listNameResolver(inboxListId) ?? "Inbox";
  const inProgressListName = listNameResolver(inProgressListId) ?? "In Progress";
  const readyForQAListName = listNameResolver(readyForQAListId) ?? "Ready for QA";

  // Build template values
  const values: Record<string, string> = {
    WATCH_LIST_NAME: watchListName,
    WATCH_LIST_ID: watchListId,
    INBOX_LIST_NAME: inboxListName,
    INBOX_LIST_ID: inboxListId,
    IN_PROGRESS_LIST_NAME: inProgressListName,
    IN_PROGRESS_LIST_ID: inProgressListId,
    READY_FOR_QA_LIST_NAME: readyForQAListName,
    READY_FOR_QA_LIST_ID: readyForQAListId,
    SHIPIT_SCRIPT: shipitScript,
    POLL_INTERVAL: String(pollIntervalMinutes),
    MAX_FILES: String(maxFilesPerCard),
  };

  // Build YAML repos block
  let reposYaml = "repos:";
  for (const repo of repos) {
    reposYaml += `\n  - name: ${repo.name}`;
    reposYaml += `\n    ghSlug: ${repo.ghSlug}`;
    reposYaml += `\n    deployBranch: ${repo.deployBranch}`;
    reposYaml += `\n    pathPrefix: "${repo.pathPrefix}"`;
  }
  values.REPOS_YAML = reposYaml;

  // Build branch check lines for MD template
  let branchLines = "";
  for (const repo of repos) {
    if (repo.pathPrefix) {
      branchLines += `   - ${repo.name} repo (\`${repo.pathPrefix}/\`): \`${repo.deployBranch}\`\n`;
    } else {
      branchLines += `   - ${repo.name} repo: \`${repo.deployBranch}\`\n`;
    }
  }
  values.BRANCH_CHECK_LINES = branchLines.trimEnd();

  // Build file patterns YAML
  values.FILE_PATTERNS_YAML = outOfScopePatterns
    .map((p) => `      - ${p}`)
    .join("\n");

  // Build keywords YAML
  values.KEYWORDS_YAML = outOfScopeKeywords
    .map((k) => `      - ${k}`)
    .join("\n");

  // Read and fill templates
  const yamlTemplate = readFileSync(
    join(TEMPLATE_DIR, "trello-loop-config.yaml.tpl"),
    "utf-8"
  );
  const mdTemplate = readFileSync(
    join(TEMPLATE_DIR, "trello-loop.md.tpl"),
    "utf-8"
  );

  const yamlContent = fillTemplate(yamlTemplate, values);
  const mdContent = fillTemplate(mdTemplate, values);

  // Write files
  const filesCreated: string[] = [];

  if (!existsSync(trelloDir)) {
    mkdirSync(trelloDir, { recursive: true });
  }

  writeFileSync(yamlPath, yamlContent, "utf-8");
  filesCreated.push(".trello/trello-loop-config.yaml");

  writeFileSync(mdPath, mdContent, "utf-8");
  filesCreated.push(".trello/trello-loop.md");

  // Update trello-config.json with qaAutomation block
  const config = loadConfig();
  if (config) {
    const repoConfigs: QARepoConfig[] = repos.map((r) => ({
      name: r.name,
      ghSlug: r.ghSlug,
      deployBranch: r.deployBranch,
      pathPrefix: r.pathPrefix,
      subdir: r.pathPrefix !== "",
    }));

    config.qaAutomation = {
      enabled: true,
      projectRoot,
      watchListId,
      inboxListId,
      inProgressListId,
      readyForQAListId,
      pollIntervalMinutes,
      shipitScript,
      repos: repoConfigs,
      outOfScopePatterns,
      outOfScopeKeywords,
      maxFilesPerCard,
    };
    saveConfig(config);
    filesCreated.push("trello-config.json (qaAutomation block)");
  }

  const loopCommand = `/loop ${pollIntervalMinutes}m @.trello/trello-loop.md Call trello_get_pending_work. If empty, stop. Otherwise process pending items per the classification rules in .trello/trello-loop-config.yaml. Use acceptEdits mode.`;

  return {
    success: true,
    filesCreated,
    filesSkipped: [],
    loopCommand,
    message: `QA automation initialized! Created ${filesCreated.length} files. Start the loop with the command below.`,
  };
}

// ============================================================
// Helpers
// ============================================================

function fillTemplate(
  template: string,
  values: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.split(`{{${key}}}`).join(value);
  }
  return result;
}
