import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false'])
  .default('true')
  .transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  LEDGER_MODE: z.enum(['demo', 'fabric']).default('demo'),
  JWT_SECRET: z.string().min(16).optional(),
  JWT_EXPIRES_IN: z.string().default('8h'),
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  DEMO_LEDGER_PATH: z.string().optional(),
  DEMO_AUTO_SEED: booleanFromString,
  FABRIC_CONNECTION_PROFILE_PATH: z.string().optional(),
  FABRIC_CHANNEL_NAME: z.string().default('logisticschannel'),
  FABRIC_CHAINCODE_NAME: z.string().default('logistics'),
  FABRIC_PEER_ENDPOINT: z.string().optional(),
  FABRIC_PEER_HOST_ALIAS: z.string().optional(),
  FABRIC_TLS_CERT_PATH: z.string().optional(),
  FABRIC_ORG1_PEER_ENDPOINT: z.string().optional(),
  FABRIC_ORG1_PEER_HOST_ALIAS: z.string().optional(),
  FABRIC_ORG1_TLS_CERT_PATH: z.string().optional(),
  FABRIC_ORG1_MSP_ID: z.string().default('Org1MSP'),
  FABRIC_ORG1_CERT_PATH: z.string().optional(),
  FABRIC_ORG1_KEY_PATH: z.string().optional(),
  FABRIC_ORG2_PEER_ENDPOINT: z.string().optional(),
  FABRIC_ORG2_PEER_HOST_ALIAS: z.string().optional(),
  FABRIC_ORG2_TLS_CERT_PATH: z.string().optional(),
  FABRIC_ORG2_MSP_ID: z.string().default('Org2MSP'),
  FABRIC_ORG2_CERT_PATH: z.string().optional(),
  FABRIC_ORG2_KEY_PATH: z.string().optional(),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  if (environment === process.env && environment.ENV_FILE) {
    loadEnvFile(environment.ENV_FILE);
  }

  const env = envSchema.parse(environment);
  const defaultDemoPath = fileURLToPath(new URL('../data/demo-ledger.json', import.meta.url));

  if ((env.LEDGER_MODE === 'fabric' || env.NODE_ENV === 'production') && !env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required in Fabric mode and production');
  }

  return {
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    ledgerMode: env.LEDGER_MODE,
    jwtSecret: env.JWT_SECRET ?? 'demo-only-jixin-secret-change-me',
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    corsOrigins: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
    demoLedgerPath: env.DEMO_LEDGER_PATH ?? defaultDemoPath,
    demoAutoSeed: env.DEMO_AUTO_SEED,
    fabric: {
      connectionProfilePath: env.FABRIC_CONNECTION_PROFILE_PATH,
      channelName: env.FABRIC_CHANNEL_NAME,
      chaincodeName: env.FABRIC_CHAINCODE_NAME,
      peerEndpoint: env.FABRIC_PEER_ENDPOINT,
      peerHostAlias: env.FABRIC_PEER_HOST_ALIAS,
      tlsCertPath: env.FABRIC_TLS_CERT_PATH,
      org1: {
        mspId: env.FABRIC_ORG1_MSP_ID,
        certPath: env.FABRIC_ORG1_CERT_PATH,
        keyPath: env.FABRIC_ORG1_KEY_PATH,
        peerEndpoint: env.FABRIC_ORG1_PEER_ENDPOINT,
        peerHostAlias: env.FABRIC_ORG1_PEER_HOST_ALIAS,
        tlsCertPath: env.FABRIC_ORG1_TLS_CERT_PATH,
      },
      org2: {
        mspId: env.FABRIC_ORG2_MSP_ID,
        certPath: env.FABRIC_ORG2_CERT_PATH,
        keyPath: env.FABRIC_ORG2_KEY_PATH,
        peerEndpoint: env.FABRIC_ORG2_PEER_ENDPOINT,
        peerHostAlias: env.FABRIC_ORG2_PEER_HOST_ALIAS,
        tlsCertPath: env.FABRIC_ORG2_TLS_CERT_PATH,
      },
    },
  } as const;
}
