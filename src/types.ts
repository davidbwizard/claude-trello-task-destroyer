export interface TrelloConfig {
  apiKey: string;
  token: string;
}

export interface TrelloBoard {
  id: string;
  name: string;
  desc: string;
  closed: boolean;
  url: string;
  idOrganization: string;
  prefs?: {
    background: string;
    backgroundImage: string | null;
  };
  dateLastActivity: string;
}

export interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  due: string | null;
  idList: string;
  idBoard: string;
  idLabels: string[];
  labels: TrelloLabel[];
  closed: boolean;
  url: string;
  dateLastActivity: string;
}

export interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
  idBoard: string;
  pos: number;
}

export interface TrelloAction {
  id: string;
  idMemberCreator: string;
  type: string;
  date: string;
  data: {
    text?: string;
    card?: {
      id: string;
      name: string;
    };
    list?: {
      id: string;
      name: string;
    };
    board: {
      id: string;
      name: string;
    };
  };
  memberCreator: {
    id: string;
    fullName: string;
    username: string;
  };
}

export interface TrelloLabel {
  id: string;
  idBoard: string;
  name: string;
  color: string;
}

export interface TrelloMember {
  id: string;
  fullName: string;
  username: string;
  avatarUrl: string | null;
}

export interface TrelloAttachment {
  id: string;
  name: string;
  url: string;
  bytes: number;
  mimeType: string;
  date: string;
  idMember: string;
  isUpload: boolean;
  fileName: string;
}

export interface RateLimiter {
  canMakeRequest(): boolean;
  waitForAvailableToken(): Promise<void>;
}

// ============================================================
// QA Automation types
// ============================================================

export interface QARepoConfig {
  name: string;
  ghSlug: string;
  deployBranch: string;
  pathPrefix: string;
  subdir?: boolean;
}

export interface QAAutomationConfig {
  enabled: boolean;
  projectRoot: string;
  watchListId: string;
  inboxListId: string;
  inProgressListId: string;
  readyForQAListId: string;
  pollIntervalMinutes: number;
  shipitScript: string;
  repos: QARepoConfig[];
  outOfScopePatterns: string[];
  outOfScopeKeywords: string[];
  maxFilesPerCard: number;
}

export type CardClassification =
  | "simple_text"
  | "complex"
  | "out_of_scope"
  | "unparseable";

export interface AutoResult {
  status: "success" | "error";
  commit?: string;
  message?: string;
  file?: string;
}

export interface PendingCard {
  id: string;
  shortId: string;
  title: string;
  description: string;
  author: string;
  url: string;
  classification: CardClassification;
  autoResult: AutoResult | null;
}

export interface PRUpdate {
  repo: string;
  prNumber: number;
  prUrl: string;
  state: "merged" | "closed";
  cardUrl: string | null;
  handled: boolean;
  comment: string | null;
}

export interface PendingWork {
  cards: PendingCard[];
  prUpdates: PRUpdate[];
  summary: string;
  lastPollTime: string | null;
}
