import axios, { AxiosInstance } from "axios";
import {
  TrelloConfig,
  TrelloBoard,
  TrelloCard,
  TrelloList,
  TrelloAction,
  TrelloLabel,
  TrelloAttachment,
} from "./types.js";
import { createTrelloRateLimiters } from "./rate-limiter.js";

export class TrelloClient {
  private axiosInstance: AxiosInstance;
  private rateLimiter;

  constructor(private config: TrelloConfig) {
    this.axiosInstance = axios.create({
      baseURL: "https://api.trello.com/1",
      params: {
        key: config.apiKey,
        token: config.token,
      },
    });

    this.rateLimiter = createTrelloRateLimiters();

    this.axiosInstance.interceptors.request.use(async (config) => {
      await this.rateLimiter.waitForAvailable();
      return config;
    });
  }

  private async handleRequest<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 429) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return this.handleRequest(request);
        }
        throw new Error(
          `Trello API error: ${error.response?.data?.message ?? error.message}`
        );
      }
      throw error;
    }
  }

  // ----------------------------------------------------------------
  // Boards
  // ----------------------------------------------------------------

  async getMyBoards(): Promise<TrelloBoard[]> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get("/members/me/boards", {
        params: { fields: "id,name,desc,closed,url,idOrganization,dateLastActivity" },
      });
      return response.data;
    });
  }

  // ----------------------------------------------------------------
  // Labels
  // ----------------------------------------------------------------

  async getBoardLabels(boardId: string): Promise<TrelloLabel[]> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get(
        `/boards/${boardId}/labels`
      );
      return response.data;
    });
  }

  // ----------------------------------------------------------------
  // Cards
  // ----------------------------------------------------------------

  async getCard(cardId: string): Promise<TrelloCard> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get(`/cards/${cardId}`, {
        params: { fields: "id,name,desc,due,idList,idBoard,idLabels,closed,url,dateLastActivity,labels" },
      });
      return response.data;
    });
  }

  async getCardsByList(listId: string): Promise<TrelloCard[]> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get(`/lists/${listId}/cards`, {
        params: { fields: "id,name,desc,due,idList,idBoard,idLabels,closed,url,dateLastActivity,labels" },
      });
      return response.data;
    });
  }

  async getCardsByLabel(
    boardId: string,
    labelId: string
  ): Promise<TrelloCard[]> {
    return this.handleRequest(async () => {
      // Trello doesn't have a direct "cards by label" endpoint, so we
      // fetch all open cards on the board and filter by label ID.
      const response = await this.axiosInstance.get(
        `/boards/${boardId}/cards`,
        {
          params: {
            filter: "open",
            fields: "id,name,desc,due,idList,idBoard,idLabels,closed,url,dateLastActivity,labels",
          },
        }
      );
      const cards: TrelloCard[] = response.data;
      return cards.filter((card) => card.idLabels.includes(labelId));
    });
  }

  async addCard(params: {
    listId: string;
    name: string;
    description?: string;
    dueDate?: string;
    labels?: string[];
  }): Promise<TrelloCard> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.post("/cards", {
        idList: params.listId,
        name: params.name,
        desc: params.description,
        due: params.dueDate,
        idLabels: params.labels,
      });
      return response.data;
    });
  }

  async updateCard(params: {
    cardId: string;
    name?: string;
    description?: string;
    dueDate?: string;
    listId?: string;
    labels?: string[];
  }): Promise<TrelloCard> {
    return this.handleRequest(async () => {
      const body: Record<string, unknown> = {};
      if (params.name !== undefined) body.name = params.name;
      if (params.description !== undefined) body.desc = params.description;
      if (params.dueDate !== undefined) body.due = params.dueDate;
      if (params.listId !== undefined) body.idList = params.listId;
      if (params.labels !== undefined) body.idLabels = params.labels;

      const response = await this.axiosInstance.put(
        `/cards/${params.cardId}`,
        body
      );
      return response.data;
    });
  }

  async moveCard(cardId: string, listId: string): Promise<TrelloCard> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.put(`/cards/${cardId}`, {
        idList: listId,
      });
      return response.data;
    });
  }

  async archiveCard(cardId: string): Promise<TrelloCard> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.put(`/cards/${cardId}`, {
        closed: true,
      });
      return response.data;
    });
  }

  // ----------------------------------------------------------------
  // Comments
  // ----------------------------------------------------------------

  async addComment(
    cardId: string,
    text: string
  ): Promise<TrelloAction> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.post(
        `/cards/${cardId}/actions/comments`,
        { text }
      );
      return response.data;
    });
  }

  // ----------------------------------------------------------------
  // Lists
  // ----------------------------------------------------------------

  async getLists(boardId: string): Promise<TrelloList[]> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get(
        `/boards/${boardId}/lists`
      );
      return response.data;
    });
  }

  async addList(boardId: string, name: string): Promise<TrelloList> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.post("/lists", {
        name,
        idBoard: boardId,
      });
      return response.data;
    });
  }

  async archiveList(listId: string): Promise<TrelloList> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.put(
        `/lists/${listId}/closed`,
        { value: true }
      );
      return response.data;
    });
  }

  // ----------------------------------------------------------------
  // Activity
  // ----------------------------------------------------------------

  async getRecentActivity(
    boardId: string,
    limit: number = 10
  ): Promise<TrelloAction[]> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get(
        `/boards/${boardId}/actions`,
        { params: { limit } }
      );
      return response.data;
    });
  }

  // ----------------------------------------------------------------
  // Member cards & search
  // ----------------------------------------------------------------

  async getMyCards(): Promise<TrelloCard[]> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get("/members/me/cards");
      return response.data;
    });
  }

  async searchAllBoards(
    query: string,
    limit: number = 10
  ): Promise<unknown> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get("/search", {
        params: {
          query,
          modelTypes: "all",
          boards_limit: limit,
          cards_limit: limit,
          organization: true,
        },
      });
      return response.data;
    });
  }

  async searchCards(
    boardId: string,
    query: string,
    limit: number = 10
  ): Promise<TrelloCard[]> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get("/search", {
        params: {
          query,
          idBoards: boardId,
          modelTypes: "cards",
          cards_limit: limit,
          card_fields:
            "id,name,desc,due,idList,idBoard,idLabels,closed,url,dateLastActivity,labels",
        },
      });
      return response.data.cards ?? [];
    });
  }

  // ----------------------------------------------------------------
  // Card creator
  // ----------------------------------------------------------------

  async getCardCreator(
    cardId: string
  ): Promise<{ fullName: string; username: string } | null> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get(
        `/cards/${cardId}/actions`,
        {
          params: {
            filter: "createCard",
            limit: 1,
          },
        }
      );
      const actions: TrelloAction[] = response.data;
      if (actions.length === 0) return null;
      return {
        fullName: actions[0].memberCreator.fullName,
        username: actions[0].memberCreator.username,
      };
    });
  }

  // ----------------------------------------------------------------
  // Attachments
  // ----------------------------------------------------------------

  async getCardAttachments(cardId: string): Promise<TrelloAttachment[]> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get(
        `/cards/${cardId}/attachments`
      );
      return response.data;
    });
  }

  async downloadAttachment(
    cardId: string,
    attachmentId: string
  ): Promise<{
    attachment: TrelloAttachment;
    content: string | null;
    url: string;
    error?: string;
  }> {
    return this.handleRequest(async () => {
      const metadataResponse = await this.axiosInstance.get(
        `/cards/${cardId}/attachments/${attachmentId}`
      );
      const attachment: TrelloAttachment = metadataResponse.data;

      if (!attachment.isUpload) {
        return { attachment, content: null, url: attachment.url };
      }

      try {
        const contentResponse = await axios.get(attachment.url, {
          responseType: "arraybuffer",
          maxRedirects: 5,
          timeout: 60000,
          headers: {
            Accept: "*/*",
            Authorization: `OAuth oauth_consumer_key="${this.config.apiKey}", oauth_token="${this.config.token}"`,
          },
        });

        const base64Content = Buffer.from(contentResponse.data).toString(
          "base64"
        );
        return { attachment, content: base64Content, url: attachment.url };
      } catch (error) {
        let errorMessage = "Unknown error";
        if (axios.isAxiosError(error)) {
          if (error.response) {
            errorMessage = `HTTP ${error.response.status}: ${error.response.statusText}`;
          } else if (error.code) {
            errorMessage = `Network error: ${error.code} - ${error.message}`;
          } else {
            errorMessage = error.message;
          }
        } else if (error instanceof Error) {
          errorMessage = error.message;
        }

        console.error("Failed to download attachment content:", errorMessage);
        return {
          attachment,
          content: null,
          url: attachment.url,
          error: `Download failed: ${errorMessage}`,
        };
      }
    });
  }
}
