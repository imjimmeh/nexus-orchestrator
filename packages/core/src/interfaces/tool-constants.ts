export const SDK_NATIVE_TOOL_NAMES = ["read", "write", "edit", "bash"] as const;

export type SdkNativeToolName = (typeof SDK_NATIVE_TOOL_NAMES)[number];
