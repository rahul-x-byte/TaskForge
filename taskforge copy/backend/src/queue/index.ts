// Queue Manager for TaskForge Workflows

const memoryQueueJobs: any[] = [];

export const workflowQueue = {
  add: async (name: string, data: any) => {
    const job = { id: `job-${Date.now()}`, name, data, timestamp: Date.now() };
    memoryQueueJobs.push(job);
    console.log('[Queue] Workflow job enqueued successfully:', job);
    return job;
  },
  getMemoryJobs: () => memoryQueueJobs,
};
