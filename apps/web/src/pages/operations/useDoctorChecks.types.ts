import { DoctorRepairActionId } from "@/lib/api/doctor.types";

export interface DoctorRepairDialogTarget {
  actionId: DoctorRepairActionId;
  checkId: string;
}
