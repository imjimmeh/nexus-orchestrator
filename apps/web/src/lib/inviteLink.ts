// Builds the copyable accept-invite link shown to the inviter after
// creating a scope invitation.
const ACCEPT_INVITE_PATH = "/accept-invite";

function resolveAppUrlBase(): string {
  const configuredBase = import.meta.env.VITE_PUBLIC_APP_URL;
  const base =
    configuredBase && configuredBase.length > 0
      ? configuredBase
      : window.location.origin;

  return base.replace(/\/$/, "");
}

export function buildInviteLink(token: string): string {
  return `${resolveAppUrlBase()}${ACCEPT_INVITE_PATH}?token=${encodeURIComponent(token)}`;
}
