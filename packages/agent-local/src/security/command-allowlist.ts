function escapeRegExp(value: string): string {
  const specialChars = [
    "\\",
    "^",
    "$",
    ".",
    "|",
    "?",
    "*",
    "+",
    "(",
    ")",
    "[",
    "]",
    "{",
    "}",
  ];
  return specialChars.reduce((result, char) => {
    return result.replaceAll(char, `\\${char}`);
  }, value);
}

function toMatcher(pattern: string): RegExp {
  const normalized = pattern.trim();
  if (normalized.length === 0) {
    return /^$/;
  }

  const parts = normalized.split("*").map((chunk) => escapeRegExp(chunk));
  const regex = `^${parts.join(".*")}$`;
  return new RegExp(regex);
}

export class CommandAllowlist {
  private readonly matchers: RegExp[];

  constructor(patterns: string[]) {
    this.matchers = patterns.map((pattern) => toMatcher(pattern));
  }

  isAllowed(command: string, args: string[]): boolean {
    if (this.matchers.length === 0) {
      return false;
    }

    const serialized = [command, ...args].join(" ").trim();
    return this.matchers.some((matcher) => matcher.test(serialized));
  }
}
