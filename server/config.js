import 'dotenv/config'

const demoMode = process.env.DEMO_MODE !== 'false'

export const config = {
  port: Number(process.env.API_PORT || 8787),
  databaseUrl: process.env.DATABASE_URL || '',
  sessionSecret: process.env.SESSION_SECRET || 'dev-session-secret-change-me',
  fiberRpcConfigured: Boolean(process.env.FIBER_RPC_URL),
  fiberReceiverRpcConfigured: Boolean(process.env.FIBER_RECEIVER_RPC_URL),
  fiberRpcUrl: process.env.FIBER_RPC_URL || 'http://127.0.0.1:8227',
  fiberReceiverRpcUrl: process.env.FIBER_RECEIVER_RPC_URL || 'http://127.0.0.1:8247',
  fiberReceiverCkbAddress: process.env.FIBER_RECEIVER_CKB_ADDRESS || '',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:8787',
  demoMode,
  otpDemoMode: process.env.OTP_DEMO_MODE === 'true' || demoMode,
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
