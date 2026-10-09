'use strict';

const path = require('path');
const { z } = require('zod');

require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(60),
  // Staff are signed out this many hours after signing in, even if active.
  SESSION_MAX_HOURS: z.coerce.number().int().positive().default(12),
  // Encrypts MFA secrets at rest. Changing it makes staff set up MFA again.
  APP_KEY: z.string().min(32, 'APP_KEY must be at least 32 characters'),

  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().default('hloinc'),
  DB_USER: z.string().default('root'),
  DB_PASSWORD: z.string().default(''),

  // "smtp" (default) or "sendmail" (the server's own mail program; no mailbox needed on cPanel).
  MAIL_TRANSPORT: z.enum(['smtp', 'sendmail']).default('smtp'),
  SENDMAIL_PATH: z.string().default('/usr/sbin/sendmail'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  MAIL_FROM: z.string().default('HLO Inc. <no-reply@hloinc.com>'),

  // Optional Cloudflare Turnstile (spam check on public forms).
  TURNSTILE_SITE_KEY: z.string().default(''),
  TURNSTILE_SECRET_KEY: z.string().default(''),
  FORMS_MAX_PER_EMAIL_PER_DAY: z.coerce.number().int().positive().default(10),
  // Test/preview copies: tell search engines not to index anything.
  NOINDEX: bool,
});

const parsed = schema.safeParse({
  ...process.env,
  // Tests run without a .env file.
  SESSION_SECRET:
    process.env.SESSION_SECRET ||
    (process.env.NODE_ENV === 'test' ? 'test-secret-test-secret-test-secret-123' : undefined),
  APP_KEY: process.env.APP_KEY || (process.env.NODE_ENV === 'test' ? 'test-app-key-test-app-key-test-app-key-1' : undefined),
});

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const env = parsed.data;

module.exports = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  appUrl: env.APP_URL.replace(/\/$/, ''),
  noindex: env.NOINDEX,
  session: {
    secret: env.SESSION_SECRET,
    idleMinutes: env.SESSION_IDLE_MINUTES,
    maxHours: env.SESSION_MAX_HOURS,
  },
  auth: {
    appKey: env.APP_KEY,
    maxFailedLogins: 5,
    lockMinutes: 15,
    resetTokenMinutes: 60,
    inviteTokenHours: 72,
    // Fewer bcrypt rounds in tests keep the suite fast; production uses 12.
    bcryptRounds: env.NODE_ENV === 'test' ? 4 : 12,
  },
  db: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    // Tests run against a separate database so they never touch real data.
    database: env.NODE_ENV === 'test' ? `${env.DB_NAME}_test` : env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
  },
  mail: {
    transport: env.MAIL_TRANSPORT,
    sendmailPath: env.SENDMAIL_PATH,
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.MAIL_FROM,
  },
  forms: {
    // Submissions faster than this are treated as bots.
    minSubmitSeconds: env.NODE_ENV === 'test' ? 0 : 3,
    maxPerEmailPerDay: env.FORMS_MAX_PER_EMAIL_PER_DAY,
  },
  turnstile: {
    enabled: Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY),
    siteKey: env.TURNSTILE_SITE_KEY,
    secretKey: env.TURNSTILE_SECRET_KEY,
  },
  paths: {
    root: path.join(__dirname, '../..'),
    views: path.join(__dirname, '../views'),
    public: path.join(__dirname, '../../public'),
    storage: path.join(__dirname, '../../storage'),
  },
};
