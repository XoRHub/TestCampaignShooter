import 'dotenv/config';
import { z } from 'zod';

const boolean = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const configSchema = z.object({
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:4000'),
  PORTAL_ORIGIN: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1),

  ORCHESTRATION_PROVIDER: z.string().default('local'),
  DEFAULT_PARALLELISM: z.coerce.number().int().positive().default(5),

  /** Automatic scheduled campaign launches. Keep enabled on ONE replica only. */
  SCHEDULER_ENABLED: boolean.default('true'),
  /** IANA timezone applied to cron expressions (defaults to the server's). */
  SCHEDULER_TIMEZONE: z.string().optional(),

  AUTH_PASSWORD_ENABLED: boolean.default('true'),
  AUTH_OIDC_ENABLED: boolean.default('false'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().optional(),

  OIDC_ISSUER: z.string().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_SCOPES: z.string().default('openid profile email'),
  OIDC_ROLES_CLAIM: z.string().default('roles'),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET: z.string().default('tcs-artifacts'),
  S3_FORCE_PATH_STYLE: boolean.default('true'),

  BUSINESS_METRICS_ENABLED: boolean.default('false'),
  PUSHGATEWAY_URL: z.string().optional(),
  BUSINESS_METRICS_JOB: z.string().default('tcs-campaigns'),
  PUSHGATEWAY_USERNAME: z.string().optional(),
  PUSHGATEWAY_PASSWORD: z.string().optional(),

  INTERNAL_CALLBACK_TOKEN: z.string().optional(),
});

export type AppConfig = z.infer<typeof configSchema> & {
  authMethods: { oidc: boolean; password: boolean };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid server configuration:\n${details}`);
  }
  const config = parsed.data;
  if (config.AUTH_OIDC_ENABLED && (!config.OIDC_ISSUER || !config.OIDC_CLIENT_ID)) {
    throw new Error('AUTH_OIDC_ENABLED=true requires OIDC_ISSUER and OIDC_CLIENT_ID');
  }
  if (!config.AUTH_OIDC_ENABLED && !config.AUTH_PASSWORD_ENABLED) {
    throw new Error('At least one auth method must be enabled (AUTH_PASSWORD_ENABLED or AUTH_OIDC_ENABLED)');
  }
  return {
    ...config,
    authMethods: { oidc: config.AUTH_OIDC_ENABLED, password: config.AUTH_PASSWORD_ENABLED },
  };
}
