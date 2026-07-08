export interface InsertAgentProfileSkillBindingInput {
  agent_profile_id: string | null;
  scope_node_id: string;
  skill_name: string;
  provenance: Record<string, unknown> | null;
}

export interface AgentProfileSkillBindingKey {
  agentProfileId: string | null;
  scopeNodeId: string;
  skillName: string;
}
