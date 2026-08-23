import type { KeyName, KeySource, KeyStatus } from "@lavega/core";

type Environment = Record<string, string | undefined>;

const KEY_ENV_VARS: Record<KeyName, string> = {
  llm: "ANTHROPIC_API_KEY",
  "market-data": "MARKET_DATA_API_KEY",
};

function processEnvironment(): Environment {
  const processLike = (globalThis as typeof globalThis & { process?: { env?: Environment } }).process;
  return processLike?.env ?? {};
}

/** Reads local server environment variables. Key values stay server-side. */
export class LocalKeySource implements KeySource {
  constructor(private readonly environment: Environment = processEnvironment()) {}

  getKey(name: KeyName): string | null {
    const value = this.environment[KEY_ENV_VARS[name]]?.trim();
    return value || null;
  }

  getStatus(name: KeyName): KeyStatus {
    const envVar = KEY_ENV_VARS[name];
    const configured = this.getKey(name) !== null;
    return {
      name,
      envVar,
      configured,
      missingMessage: configured ? null : `Required key ${envVar} is missing.`,
    };
  }
}
