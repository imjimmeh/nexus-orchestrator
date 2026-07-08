export interface ProviderCapabilities {
  supportsCreate: boolean;
  supportsUpdate: boolean;
  supportsDelete: boolean;
  supportsWebhooks: boolean;
  supportsPolling: boolean;
  supportsComments: boolean;
  supportsAttachments: boolean;
  paginationLimit?: number;
}

export interface ExternalTicket {
  id: string;
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  url?: string;
  assignee?: string;
  labels?: string[];
  rawMetadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExternalTicketChangeEvent {
  externalId: string;
  action: "created" | "updated" | "deleted";
  ticket?: ExternalTicket;
  timestamp: string;
  connectionId?: string;
  rawPayload?: unknown;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface IExternalTicketProvider {
  readonly providerType: string;
  readonly capabilities: ProviderCapabilities;

  validateConfig(config: unknown): boolean | Promise<boolean>;

  fetchTickets(params?: unknown): Promise<PaginatedResult<ExternalTicket>>;
  fetchTicket(externalId: string): Promise<ExternalTicket | null>;
  createTicket(data: Partial<ExternalTicket>): Promise<ExternalTicket>;
  updateTicket(
    externalId: string,
    data: Partial<ExternalTicket>,
  ): Promise<ExternalTicket>;
  deleteTicket(externalId: string): Promise<void>;

  validateWebhookSignature(
    payload: unknown,
    signature: string,
    secret?: string,
  ): boolean;
  parseWebhookEvents(payload: unknown): ExternalTicketChangeEvent[];
}
