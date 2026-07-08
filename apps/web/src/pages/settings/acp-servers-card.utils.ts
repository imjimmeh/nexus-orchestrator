import { AcpAuthType } from "@/lib/api/acp.types";
import { AcpServer } from "@/lib/api/acp.types";

const ACP_SERVER_STATUS_CONNECTED = "connected" as AcpServer["last_status"];
const ACP_SERVER_STATUS_FAILED = "failed" as AcpServer["last_status"];
const ACP_SERVER_STATUS_DISABLED = "disabled" as AcpServer["last_status"];

export function statusVariant(
  status: AcpServer["last_status"],
): "default" | "secondary" | "destructive" | "outline" {
  if (status === ACP_SERVER_STATUS_CONNECTED) {
    return "default";
  }
  if (status === ACP_SERVER_STATUS_FAILED) {
    return "destructive";
  }
  if (status === ACP_SERVER_STATUS_DISABLED) {
    return "outline";
  }
  return "secondary";
}

export function authTypeLabel(authType: AcpServer["auth_type"]): string {
  switch (authType) {
    case AcpAuthType.NONE:
      return "None";
    case AcpAuthType.BEARER:
      return "Bearer";
    case AcpAuthType.API_KEY:
      return "API Key";
    default:
      return authType;
  }
}
