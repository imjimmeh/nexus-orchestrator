import type { TurnUsageRecorderService } from '../cost-governance/turn-usage-recorder.service';

/** The narrow slice of the usage recorder the telemetry gateway depends on. */
export type TurnUsageRecorderDep = Pick<
  TurnUsageRecorderService,
  'recordTurnUsage'
>;
