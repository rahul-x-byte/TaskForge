// Database Manager with Postgres & Memory Fallback Engine

const memoryWorkflows = new Map<string, any>();
const memoryVersions = new Map<string, any>();
const memoryRuns = new Map<string, any>();
const memoryRunSteps = new Map<string, any[]>();

// Pre-populate initial sample workflow at backend startup
const initialWfId = 'sample-automated-download-workflow';
const initialVerId = 'sample-automated-download-version';
const initialSteps = [
  {
    action: 'navigate',
    timestamp: Date.now(),
    selectors: { css: 'window' },
    value: 'http://localhost:3001/login',
    pageUrl: 'http://localhost:3001/login',
  },
  {
    action: 'input',
    timestamp: Date.now() + 100,
    selectors: { css: '#username', role: 'textbox', name: 'Username' },
    value: 'admin',
    pageUrl: 'http://localhost:3001/login',
  },
  {
    action: 'input',
    timestamp: Date.now() + 200,
    selectors: { css: '#password', role: 'textbox', name: 'Password' },
    value: '[REDACTED]',
    pageUrl: 'http://localhost:3001/login',
  },
  {
    action: 'click',
    isSensitive: true,
    timestamp: Date.now() + 300,
    selectors: { css: '#login-submit', role: 'button', name: 'Login' },
    pageUrl: 'http://localhost:3001/login',
  },
  {
    action: 'click',
    timestamp: Date.now() + 400,
    selectors: { css: '#download-report-btn', role: 'link', name: 'Download Report', text: 'Download Report' },
    pageUrl: 'http://localhost:3001/reports',
  },
];

memoryWorkflows.set(initialWfId, {
  id: initialWfId,
  name: 'Sample Automated Report Download Workflow',
  created_at: new Date().toISOString(),
  current_version_id: initialVerId,
});

memoryVersions.set(initialVerId, {
  id: initialVerId,
  workflow_id: initialWfId,
  steps: initialSteps,
  created_at: new Date().toISOString(),
});

export async function query(text: string, params: any[] = []): Promise<{ rows: any[] }> {
  const normalizedSql = text.trim().toLowerCase();

  // 1. INSERT INTO workflows
  if (normalizedSql.startsWith('insert into workflows')) {
    const [id, name] = params;
    const item = { id, name, created_at: new Date().toISOString(), current_version_id: null };
    memoryWorkflows.set(id, item);
    return { rows: [item] };
  }

  // 2. INSERT INTO workflow_versions
  if (normalizedSql.startsWith('insert into workflow_versions')) {
    const [id, workflow_id, steps] = params;
    const stepsArr = typeof steps === 'string' ? JSON.parse(steps) : steps;
    const item = { id, workflow_id, steps: stepsArr, created_at: new Date().toISOString() };
    memoryVersions.set(id, item);
    return { rows: [item] };
  }

  // 3. UPDATE workflows SET current_version_id
  if (normalizedSql.startsWith('update workflows set current_version_id')) {
    const [versionId, workflowId] = params;
    const wf = memoryWorkflows.get(workflowId);
    if (wf) {
      wf.current_version_id = versionId;
      memoryWorkflows.set(workflowId, wf);
    }
    return { rows: wf ? [wf] : [] };
  }

  // 3b. UPDATE workflow_versions SET steps
  if (normalizedSql.startsWith('update workflow_versions set steps')) {
    const [steps, versionId] = params;
    const stepsArr = typeof steps === 'string' ? JSON.parse(steps) : steps;
    const ver = memoryVersions.get(versionId);
    if (ver) {
      ver.steps = stepsArr;
      memoryVersions.set(versionId, ver);
    }
    return { rows: ver ? [ver] : [] };
  }

  // 4. SELECT FROM workflows LEFT JOIN workflow_versions
  if (normalizedSql.includes('from workflows') && normalizedSql.includes('left join workflow_versions')) {
    if (params.length > 0 && normalizedSql.includes('where w.id =')) {
      const wf = memoryWorkflows.get(params[0]);
      if (!wf) return { rows: [] };
      const ver = memoryVersions.get(wf.current_version_id);
      const wfRuns = Array.from(memoryRuns.values()).filter((r) => r.workflow_id === wf.id);
      let lastStatus = 'never_run';
      if (wfRuns.length > 0) {
        wfRuns.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
        const latestStatus = wfRuns[0].status;
        if (latestStatus === 'completed' || latestStatus === 'success') lastStatus = 'success';
        else if (latestStatus === 'failed' || latestStatus === 'timed_out') lastStatus = 'failed';
        else if (latestStatus === 'awaiting_approval' || latestStatus === 'awaiting_credentials' || latestStatus === 'pending' || latestStatus === 'running') lastStatus = 'awaiting_approval';
        else lastStatus = 'never_run';
      }
      return { rows: [{ ...wf, steps: ver ? ver.steps : [], last_status: lastStatus, lastStatus }] };
    }

    const list: any[] = [];
    memoryWorkflows.forEach((wf) => {
      const ver = memoryVersions.get(wf.current_version_id);
      const wfRuns = Array.from(memoryRuns.values()).filter((r) => r.workflow_id === wf.id);
      let lastStatus = 'never_run';
      if (wfRuns.length > 0) {
        wfRuns.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
        const latestStatus = wfRuns[0].status;
        if (latestStatus === 'completed' || latestStatus === 'success') lastStatus = 'success';
        else if (latestStatus === 'failed' || latestStatus === 'timed_out') lastStatus = 'failed';
        else if (latestStatus === 'awaiting_approval' || latestStatus === 'awaiting_credentials' || latestStatus === 'pending' || latestStatus === 'running') lastStatus = 'awaiting_approval';
        else lastStatus = 'never_run';
      }
      list.push({ ...wf, steps: ver ? ver.steps : [], last_status: lastStatus, lastStatus });
    });
    return { rows: list };
  }

  // 5. SELECT FROM workflows WHERE id = $1
  if (normalizedSql.includes('from workflows where id =')) {
    const wf = memoryWorkflows.get(params[0]);
    return { rows: wf ? [wf] : [] };
  }

  // 6. INSERT INTO runs
  if (normalizedSql.startsWith('insert into runs')) {
    const [id, workflow_id, version_id, status] = params;
    const item = { id, workflow_id, version_id, status: status || 'pending', started_at: new Date().toISOString(), finished_at: null };
    memoryRuns.set(id, item);
    return { rows: [item] };
  }

  // 7. SELECT FROM runs WHERE id = $1
  if (normalizedSql.includes('from runs where id =')) {
    const run = memoryRuns.get(params[0]);
    return { rows: run ? [run] : [] };
  }

  // 8. SELECT FROM run_steps WHERE run_id = $1
  if (normalizedSql.includes('from run_steps where run_id =')) {
    const steps = memoryRunSteps.get(params[0]) || [];
    return { rows: steps };
  }

  // 9. UPDATE runs SET status
  if (normalizedSql.startsWith('update runs set status')) {
    const [statusVal, runIdVal] = params;
    const run = memoryRuns.get(runIdVal);
    if (run) {
      run.status = statusVal;
      if (statusVal === 'completed' || statusVal === 'failed' || statusVal === 'cancelled' || statusVal === 'timed_out') {
        run.finished_at = new Date().toISOString();
      }
      memoryRuns.set(run.id, run);
      return { rows: [run] };
    }
    return { rows: [] };
  }

  // 10. SELECT FROM runs
  if (normalizedSql.includes('from runs')) {
    const runsList = Array.from(memoryRuns.values()).map((r) => {
      const wf = memoryWorkflows.get(r.workflow_id);
      return { ...r, workflow_name: wf ? wf.name : r.workflow_id };
    });
    runsList.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
    return { rows: runsList };
  }

  return { rows: [] };
}

export const pool = {
  query,
  end: async () => {},
};
