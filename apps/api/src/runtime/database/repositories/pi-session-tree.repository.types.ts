export interface LearningSessionTreeSource {
  id: string;
  workflow_run_id?: string | null;
  chat_session_id?: string | null;
  jsonl_data: unknown[];
  created_at: Date;
  updated_at: Date;
  workflow_status?: string | null;
  chat_status?: string | null;
  chat_scope_id?: string | null;
}
