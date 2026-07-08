export interface TelegramUpdateMessage {
  message_id: number;
  text?: string;
  from?: {
    id?: number;
    username?: string;
  };
  chat?: {
    id?: number;
    type?: string;
  };
}

export interface TelegramCallbackQuery {
  id: string;
  from?: {
    id?: number;
  };
  message?: {
    message_id?: number;
    chat?: {
      id?: number;
    };
  };
  data?: string;
}

export interface TelegramUpdatePayload {
  update_id?: number;
  message?: TelegramUpdateMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramGetUpdatesResponse {
  ok?: boolean;
  result?: TelegramUpdatePayload[];
  description?: string;
}

export interface TelegramApiResponseBase {
  ok?: boolean;
  result?: unknown;
  description?: string;
}

export interface TelegramSendMessageResponse extends TelegramApiResponseBase {
  result?: {
    message_id?: number;
  };
}

export interface TelegramEditMessageTextResponse extends TelegramApiResponseBase {
  result?:
    | {
        message_id?: number;
      }
    | true;
}

export interface TelegramSetMyCommandsResponse extends TelegramApiResponseBase {
  result?: true;
}

export type TelegramChatActionName = 'typing';

export interface TelegramCommandMenuItem {
  command: string;
  description: string;
}
