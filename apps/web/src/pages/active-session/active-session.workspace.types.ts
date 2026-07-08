export type ActiveSessionControlNoticeType = "info" | "success" | "error";

export interface ActiveSessionControlNotice {
  type: ActiveSessionControlNoticeType;
  title: string;
  message: string;
}
