import { describe, expect, it } from "vitest";
import { JOB_TYPE_CONFIG, STEP_TYPE_CONFIG } from "./node-types";

describe("node-types", () => {
  describe("JOB_TYPE_CONFIG", () => {
    it("has all 10 job types", () => {
      const expectedJobTypes = [
        "execution",
        "invoke_workflow",
        "run_command",
        "emit_event",
        "http_webhook",
        "web_automation",
        "mcp_tool_call",
        "git_operation",
        "register_tool",
        "manage_tool_candidate",
      ] as const;

      expect(Object.keys(JOB_TYPE_CONFIG)).toHaveLength(10);
      for (const jobType of expectedJobTypes) {
        expect(JOB_TYPE_CONFIG).toHaveProperty(jobType);
      }
    });

    it("has correct labels for each job type", () => {
      expect(JOB_TYPE_CONFIG.execution.label).toBe("Execution");
      expect(JOB_TYPE_CONFIG.invoke_workflow.label).toBe("Invoke Workflow");
      expect(JOB_TYPE_CONFIG.run_command.label).toBe("Run Command");
      expect(JOB_TYPE_CONFIG.emit_event.label).toBe("Emit Event");
      expect(JOB_TYPE_CONFIG.http_webhook.label).toBe("HTTP Webhook");
      expect(JOB_TYPE_CONFIG.web_automation.label).toBe("Web Automation");
      expect(JOB_TYPE_CONFIG.mcp_tool_call.label).toBe("MCP Tool Call");
      expect(JOB_TYPE_CONFIG.git_operation.label).toBe("Git Operation");
      expect(JOB_TYPE_CONFIG.register_tool.label).toBe("Register Tool");
      expect(JOB_TYPE_CONFIG.manage_tool_candidate.label).toBe(
        "Manage Tool Candidate",
      );
    });

    it("has icon and color for every job type", () => {
      for (const config of Object.values(JOB_TYPE_CONFIG)) {
        expect(config.icon).toBeDefined();
        expect(typeof config.color).toBe("string");
        expect(config.color.length).toBeGreaterThan(0);
      }
    });
  });

  describe("STEP_TYPE_CONFIG", () => {
    it("has all 4 step types", () => {
      const expectedStepTypes = [
        "agent",
        "run_command",
        "set_variable",
        "wait",
      ] as const;

      expect(Object.keys(STEP_TYPE_CONFIG)).toHaveLength(4);
      for (const stepType of expectedStepTypes) {
        expect(STEP_TYPE_CONFIG).toHaveProperty(stepType);
      }
    });

    it("has correct labels for each step type", () => {
      expect(STEP_TYPE_CONFIG.agent.label).toBe("Agent");
      expect(STEP_TYPE_CONFIG.run_command.label).toBe("Command");
      expect(STEP_TYPE_CONFIG.set_variable.label).toBe("Set Variable");
      expect(STEP_TYPE_CONFIG.wait.label).toBe("Wait");
    });

    it("has icon and color for every step type", () => {
      for (const config of Object.values(STEP_TYPE_CONFIG)) {
        expect(config.icon).toBeDefined();
        expect(typeof config.color).toBe("string");
        expect(config.color.length).toBeGreaterThan(0);
      }
    });
  });
});
