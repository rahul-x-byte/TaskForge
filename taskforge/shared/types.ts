export type UserRole = 'admin' | 'user';

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at: string;
  updated_at?: string;
  workflow_count?: number;
  run_count?: number;
}

export interface AuthResponse {
  token: string;
  user: Profile;
}

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'waiting_approval' | 'awaiting_approval' | 'timed_out' | 'awaiting_credentials' | 'awaiting_login';

export interface SelectorBundle {
  role?: string;
  name?: string;
  text?: string;
  testId?: string;
  css?: string;
  videoId?: string;
  inputType?: string;
}

export interface RecordedAction {
  action: string;
  timestamp: number;
  selectors: SelectorBundle;
  value?: string;
  pageUrl: string;
  isSensitive?: boolean;
}

export interface WorkflowStep {
  id: string;
  name: string;
  action: string;
  selectors?: SelectorBundle;
  params?: Record<string, unknown>;
  sequenceOrder: number;
  isSensitive?: boolean;
}

export interface WorkflowDefinition {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  current_version_id?: string;
  created_at: string;
  steps?: WorkflowStep[] | RecordedAction[];
  last_status?: string;
  lastStatus?: string;
  latest_run_id?: string | null;
  latestRunId?: string | null;
}

export interface WorkflowJobPayload {
  workflowId: string;
  versionId: string;
  runId: string;
}
