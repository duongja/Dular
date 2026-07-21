import 'dotenv/config'

const demoMode = process.env.DEMO_MODE === 'true'

function integerEnv(name, fallback) {
  const value = Number(process.env[name] || fallback)
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`)
  return value
}

export const config = {
  port: Number(process.env.API_PORT || 8787),
  databaseUrl: process.env.DATABASE_URL || '',
  sessionSecret: process.env.SESSION_SECRET || 'dev-session-secret-change-me',
  fiberRpcConfigured: Boolean(process.env.FIBER_RPC_URL),
  fiberReceiverRpcConfigured: Boolean(process.env.FIBER_RECEIVER_RPC_URL),
  fiberRpcUrl: process.env.FIBER_RPC_URL || 'http://127.0.0.1:8227',
  fiberRpcToken: process.env.FIBER_GATEWAY_RPC_TOKEN || '',
  fiberReceiverRpcUrl: process.env.FIBER_RECEIVER_RPC_URL || 'http://127.0.0.1:8247',
  fiberReceiverCkbAddress: process.env.FIBER_RECEIVER_CKB_ADDRESS || '',
  fiberOperatorWsAddr: process.env.FIBER_OPERATOR_WS_ADDR || '',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:8787',
  demoMode,
  otpDemoMode: process.env.OTP_DEMO_MODE === 'true' || demoMode,
  legacyManagedWalletEnabled: process.env.LEGACY_MANAGED_WALLET_ENABLED === 'true',
  ramp: {
    depositsEnabled: process.env.RAMP_DEPOSITS_ENABLED === 'true' || demoMode,
    withdrawalsEnabled: process.env.RAMP_WITHDRAWALS_ENABLED === 'true',
    minKes: integerEnv('RAMP_MIN_KES', 10),
    maxKes: integerEnv('RAMP_MAX_KES', 1000),
    feeBps: integerEnv('RAMP_FEE_BPS', 25),
    quoteExpiresInSeconds: integerEnv('RAMP_QUOTE_EXPIRES_SECONDS', 300),
    callbackToken: process.env.RAMP_CALLBACK_TOKEN || '',
    operatorToken: process.env.RAMP_OPERATOR_TOKEN || '',
    fxUrl: process.env.RAMP_FX_URL || 'https://open.er-api.com/v6/latest/USD',
    configuredRate: process.env.RAMP_USD_KES_RATE || '',
    ckbSponsorEnabled: process.env.RAMP_CKB_SPONSOR_ENABLED === 'true',
    ckbSponsorAmount: integerEnv('RAMP_CKB_SPONSOR_AMOUNT', 200),
    receiveRoutesEnabled: process.env.RAMP_RECEIVE_ROUTES_ENABLED !== 'false',
    maxRouteRUsdBaseUnits: String(integerEnv('RAMP_MAX_ROUTE_RUSD_BASE_UNITS', 2000000000)),
    maxReservedRUsdBaseUnits: String(integerEnv('RAMP_MAX_RESERVED_RUSD_BASE_UNITS', 10000000000)),
  },
  mpesa: {
    environment: process.env.MPESA_ENVIRONMENT || 'production',
    consumerKey: process.env.MPESA_CONSUMER_KEY || '',
    consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
    shortcode: process.env.MPESA_SHORTCODE || '',
    passkey: process.env.MPESA_PASSKEY || '',
    b2cShortcode: process.env.MPESA_B2C_SHORTCODE || '',
    initiatorName: process.env.MPESA_INITIATOR_NAME || '',
    securityCredential: process.env.MPESA_SECURITY_CREDENTIAL || process.env.MPESA_PROD_SECURITY_CREDENTIAL || '',
    timeoutUrl: process.env.MPESA_TIMEOUT_URL || '',
  },
  africasTalking: {
    username: process.env.AT_USERNAME || '',
    apiKey: process.env.AT_API_KEY || '',
    senderId: process.env.AT_SENDER_ID || '',
  },
  ussd: {
    enabled: process.env.USSD_ENABLED !== 'false',
    withdrawalsEnabled: process.env.USSD_WITHDRAWALS_ENABLED === 'true',
    serviceCode: process.env.USSD_SERVICE_CODE || '*483*XXXX#',
  },
}

export function requireDatabaseUrl() {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required. Set DEMO_MODE=true only for provider mocks, not database access.')
  }
}
