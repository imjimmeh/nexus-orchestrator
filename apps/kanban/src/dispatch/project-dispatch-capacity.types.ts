export interface ProjectDispatchCapacity {
  maxActive: number;
  activeCount: number;
  availableSlots: number;
  projectAvailableSlots: number;
  canLaunchNewWork: boolean;
}
