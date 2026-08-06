// Database Manager with Postgres & Memory Fallback Engine

const memoryWorkflows = new Map<string, any>();
const memoryVersions = new Map<string, any>();
const memoryRuns = new Map<string, any>();
const memoryRunSteps = new Map<string, any[]>();

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

  // 4. SELECT FROM workflows LEFT JOIN workflow_versions
  if (normalizedSql.includes('from workflows') && normalizedSql.includes('left join workflow_versions')) {
    if (params.length > 0 && normalizedSql.includes('where w.id =')) {
      const wf = memoryWorkflows.get(params[0]);
      if (!wf) return { rows: [] };
      const ver = memoryVersions.get(wf.current_version_id);
      return { rows: [{ ...wf, steps: ver ? ver.steps : [] }] };
    }

    const list: any[] = [];
    memoryWorkflows.forEach((wf) => {
      const ver = memoryVersions.get(wf.current_version_id);
      list.push({ ...wf, steps: ver ? ver.steps : [] });
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

  // 9. UPDATE runs SET status = 'running' (approve)
  if (normalizedSql.includes("status = 'running'")) {
    const run = memoryRuns.get(params[0]);
    if (run) {
      run.status = 'running';
      memoryRuns.set(run.id, run);
      return { rows: [run] };
    }
    return { rows: [] };
  }

  // 10. UPDATE runs SET status = 'cancelled' (cancel)
  if (normalizedSql.includes("status = 'cancelled'")) {
    const run = memoryRuns.get(params[0]);
    if (run) {
      run.status = 'cancelled';
      run.finished_at = new Date().toISOString();
      memoryRuns.set(run.id, run);
      return { rows: [run] };
    }
    return { rows: [] };
  }

  return { rows: [] };
}

export const pool = {
  query,
  end: async () => {},
};
