import { useState, useCallback, useRef, useMemo } from "react";
import { useCreateChatSession } from "./useChatSessions";
import { useChatSessionTelemetry } from "./useChatSessionTelemetry";
import { toSessionChatMessages } from "@/pages/active-session/active-session.chat-builder";
import type { SteeringChatMessage } from "@/components/chat/SteeringChatPanel";
import { ChatSessionDetail } from "@/lib/api/chat-sessions.types";
import { SteeringPlan } from "@/lib/api/steering.types";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import { api } from "@/lib/api/client";

interface UseSteeringChatResult {
  isActive: boolean;
  sessionId: string | null;
  session: ChatSessionDetail | null;
  messages: SteeringChatMessage[];
  isLoading: boolean;
  error: string | null;
  startSteering: (projectId: string) => Promise<void>;
  sendSteeringMessage: (message: string) => Promise<void>;
  approvePlan: (planId: string) => Promise<void>;
  rejectPlan: (planId: string, reason?: string) => Promise<void>;
  modifyPlan: (planId: string) => Promise<void>;
  closeSteering: () => void;
  clearError: () => void;
}

function toSteeringChatMessages(
  events: WorkflowTelemetryEvent[],
): SteeringChatMessage[] {
  const baseMessages = toSessionChatMessages(events);
  return baseMessages.map((msg): SteeringChatMessage => {
    if (msg.role === "event" && msg.detailsContent) {
      try {
        const parsed = JSON.parse(msg.detailsContent);
        if (parsed?.steering_plan) {
          return {
            ...msg,
            metadata: {
              type: "steering_plan" as const,
              plan: parsed.steering_plan as SteeringPlan,
              planId: parsed.steering_plan.id ?? msg.id,
            },
          };
        }
      } catch {
        // Not JSON, leave message as-is
      }
    }
    return msg;
  });
}

export function useSteeringChat(): UseSteeringChatResult {
  const [isActive, setIsActive] = useState(false);
  const [session, setSession] = useState<ChatSessionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createSession = useCreateChatSession();
  const sessionIdRef = useRef<string | null>(null);

  const sessionId = sessionIdRef.current;
  const { events } = useChatSessionTelemetry(sessionId ?? undefined);

  const messages: SteeringChatMessage[] = useMemo(() => {
    if (!events || events.length === 0) return [];
    return toSteeringChatMessages(events);
  }, [events]);

  const startSteering = useCallback(
    async (projectId: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await createSession.mutateAsync({
          agentProfileName: "ceo-agent",
          projectId,
          initialMessage: "Start steering session",
          sessionType: "steering" as const,
        });
        sessionIdRef.current = result.id;
        setSession(result as unknown as ChatSessionDetail);
        setIsActive(true);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to start steering session",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [createSession],
  );

  const sendSteeringMessage = useCallback(async (message: string) => {
    if (!sessionIdRef.current) return;
    try {
      await api.sendChatSessionMessage(sessionIdRef.current, message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    }
  }, []);

  const approvePlan = useCallback(async (planId: string) => {
    if (!sessionIdRef.current) return;
    try {
      await api.sendChatSessionMessage(
        sessionIdRef.current,
        `Approve steering plan ${planId}. Continue using kanban-owned project and work-item APIs only.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve plan");
    }
  }, []);

  const rejectPlan = useCallback(async (planId: string, reason?: string) => {
    if (!sessionIdRef.current) return;
    try {
      await api.sendChatSessionMessage(
        sessionIdRef.current,
        `Reject steering plan ${planId}.${reason ? ` Reason: ${reason}` : ""}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject plan");
    }
  }, []);

  const modifyPlan = useCallback(async (planId: string) => {
    if (!sessionIdRef.current) return;
    try {
      await api.sendChatSessionMessage(
        sessionIdRef.current,
        `I'd like to modify plan ${planId}. Please suggest changes.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to modify plan");
    }
  }, []);

  const closeSteering = useCallback(() => {
    setIsActive(false);
    setSession(null);
    sessionIdRef.current = null;
    setError(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    isActive,
    sessionId: sessionIdRef.current,
    session,
    messages,
    isLoading,
    error,
    startSteering,
    sendSteeringMessage,
    approvePlan,
    rejectPlan,
    modifyPlan,
    closeSteering,
    clearError,
  };
}
