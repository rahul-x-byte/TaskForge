export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'waiting_approval';

export interface SelectorBundle {
  role?: string;
  name?: string;
  text?: string;
  testId?: string;
  css?: string;
}

export interface RecordedAction {
  action: string;
  timestamp: number;
  selectors: SelectorBundle;
  value?: string;
  pageUrl: string;
}

export interface WorkflowStep {
  id: string;
  name: string;
  action: string;
  selectors?: SelectorBundle;
  params?: Record<string, unknown>;
  sequenceOrder: number;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  current_version_id?: string;
  created_at: string;
  steps?: WorkflowStep[] | RecordedAction[];
}

export interface WorkflowJobPayload {
  workflowId: string;
  versionId: string;
  runId: string;
}
