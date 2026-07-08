import type { PluginContributionsDeclareMessage } from "../src";

const validToolContributionDeclaration: PluginContributionsDeclareMessage = {
  protocolVersion: "2026-05-17",
  type: "contributions.declare",
  pluginId: "com.acme.workflow-tools",
  correlationId: "runtime-message-1",
  contributions: [
    {
      id: "acme.send_message",
      type: "tool",
      displayName: "Send Message",
      config: {
        inputSchema: {
          type: "object",
        },
        operation: "execute",
      },
    },
  ],
};

const validLegacySpecialStepContributionDeclaration: PluginContributionsDeclareMessage =
  {
    protocolVersion: "2026-05-17",
    type: "contributions.declare",
    pluginId: "com.acme.workflow-tools",
    correlationId: "runtime-message-2",
    contributions: [
      {
        id: "acme.send_webhook",
        type: "special_step",
        displayName: "Send Webhook",
      },
    ],
  };

const invalidToolContributionDeclaration: PluginContributionsDeclareMessage = {
  protocolVersion: "2026-05-17",
  type: "contributions.declare",
  pluginId: "com.acme.workflow-tools",
  correlationId: "runtime-message-3",
  contributions: [
    // @ts-expect-error Tool contribution declarations require typed config.
    {
      id: "acme.send_message",
      type: "tool",
      displayName: "Send Message",
    },
  ],
};

const invalidWorkflowStepContributionDeclaration: PluginContributionsDeclareMessage =
  {
    protocolVersion: "2026-05-17",
    type: "contributions.declare",
    pluginId: "com.acme.workflow-tools",
    correlationId: "runtime-message-4",
    contributions: [
      {
        id: "acme.workflow.notify",
        type: "workflow.step",
        displayName: "Notify Acme",
        config: {
          stepType: "acme.notify",
          inputContract: "NotifyInput",
          // @ts-expect-error Known contribution configs reject unknown fields.
          unexpected: true,
        },
      },
    ],
  };

void validToolContributionDeclaration;
void validLegacySpecialStepContributionDeclaration;
void invalidToolContributionDeclaration;
void invalidWorkflowStepContributionDeclaration;
