// Queue Manager for TaskForge Workflows
const memoryQueueJobs = [];
export const workflowQueue = {
    add: async (name, data) => {
        const job = { id: `job-${Date.now()}`, name, data, timestamp: Date.now() };
        memoryQueueJobs.push(job);
        console.log('[Queue] Workflow job enqueued successfully:', job);
        return job;
    },
    getMemoryJobs: () => memoryQueueJobs,
};
