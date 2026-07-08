import type Docker from 'dockerode';

export async function resolveContainerContextForSubagent(params: {
  docker?: Docker;
  workflowRunId: string;
  jobId?: string;
  stepId?: string;
}): Promise<string | null> {
  if (!params.docker) {
    return null;
  }

  const strictLabelFilters = [
    'nexus.managed=true',
    `nexus.workflow_run_id=${params.workflowRunId}`,
    ...(params.jobId ? [`nexus.job_id=${params.jobId}`] : []),
    ...(params.stepId ? [`nexus.step_id=${params.stepId}`] : []),
  ];

  const strictMatch = await findMostRecentRunningContainerByLabels(
    params.docker,
    strictLabelFilters,
  );
  if (strictMatch) {
    return strictMatch;
  }

  return findMostRecentRunningContainerByLabels(params.docker, [
    'nexus.managed=true',
    `nexus.workflow_run_id=${params.workflowRunId}`,
  ]);
}

async function findMostRecentRunningContainerByLabels(
  docker: Docker,
  labels: string[],
): Promise<string | null> {
  const containers = await docker.listContainers({
    all: false,
    filters: {
      label: labels,
      status: ['running'],
    },
  });

  const sortedContainers = [...containers].sort(
    (a, b) => b.Created - a.Created,
  );
  const match = sortedContainers[0];
  return match?.Id ?? null;
}
