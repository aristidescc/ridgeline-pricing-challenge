export interface AppConfig {
  port: number;
  /** Fixed processing time (ISO 8601). Unset = wall clock. */
  asOf: string | undefined;
  stock: {
    client: 'http' | 'fixture';
    baseUrl: string;
    timeoutMs: number;
    maxAttempts: number;
    baseDelayMs: number;
    fixturePath: string;
  };
  reportingDbDir: string;
  appDbPath: string;
  rulesPath: string;
  serviceUsersPath: string;
}

function int(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid integer env value: ${value}`);
  }
  return n;
}

export default (): AppConfig => {
  const env = process.env;
  const client = env.STOCK_CLIENT ?? 'http';
  if (client !== 'http' && client !== 'fixture') {
    throw new Error(
      `STOCK_CLIENT must be "http" or "fixture", got "${client}"`,
    );
  }
  if (env.AS_OF && Number.isNaN(Date.parse(env.AS_OF))) {
    throw new Error(`AS_OF is not a valid ISO 8601 timestamp: ${env.AS_OF}`);
  }
  return {
    port: int(env.PORT, 3000),
    asOf: env.AS_OF || undefined,
    stock: {
      client,
      baseUrl: env.STOCK_API_URL || 'http://localhost:8080',
      timeoutMs: int(env.STOCK_TIMEOUT_MS, 1000),
      maxAttempts: int(env.STOCK_MAX_ATTEMPTS, 4),
      baseDelayMs: int(env.STOCK_BASE_DELAY_MS, 200),
      fixturePath: env.STOCK_FIXTURE_PATH || 'data-pack/stock_fixture.json',
    },
    reportingDbDir: env.REPORTING_DB_DIR || 'data-pack/reporting_db',
    appDbPath: env.APP_DB_PATH || 'data/app.db',
    rulesPath: env.RULES_PATH || 'config/approval-rules.json',
    serviceUsersPath: env.SERVICE_USERS_PATH || 'config/service-users.json',
  };
};
