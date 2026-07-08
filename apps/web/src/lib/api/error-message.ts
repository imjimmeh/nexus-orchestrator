import axios from "axios";

interface ApiErrorPayload {
  error?: {
    message?: string | string[];
  };
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data as ApiErrorPayload | undefined;
    const message = payload?.error?.message;

    if (Array.isArray(message) && message.length > 0) {
      return message[0];
    }

    if (typeof message === "string" && message.length > 0) {
      return message;
    }

    if (error.message) {
      return error.message;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
