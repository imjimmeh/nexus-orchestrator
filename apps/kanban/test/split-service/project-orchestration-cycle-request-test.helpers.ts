type EmittedDomainEvent = {
  eventName: string;
  payload: Record<string, unknown>;
};

type DomainEventEmitterMock = {
  emitDomainEvent: {
    mock: {
      calls: Array<[EmittedDomainEvent]>;
    };
  };
};

export function getCycleRequestsForProject(
  coreClient: DomainEventEmitterMock,
  projectId: string,
) {
  return coreClient.emitDomainEvent.mock.calls.filter(
    ([event]) =>
      event.eventName === "ProjectOrchestrationCycleRequestedEvent" &&
      (event.payload.scopeId ?? event.payload.projectId) === projectId,
  );
}
