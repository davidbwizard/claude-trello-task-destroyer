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
