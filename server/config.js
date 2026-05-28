import 'dotenv/config'

export const config = {
  port: Number(process.env.API_PORT || 8787),
  databaseUrl: process.env.DATABASE_URL || '',
  sessionSecret: process.env.SESSION_SECRET || 'dev-session-secret-change-me',
  fiberRpcUrl: process.env.FIBER_RPC_URL || 'http://127.0.0.1:8227',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:8787',
  demoMode: process.env.DEMO_MODE !== 'false',
  mpesa: {
    environment: process.env.MPESA_ENVIRONMENT || 'production',
    consumerKey: process.env.MPESA_CONSUMER_KEY || '',
    consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
    shortcode: process.env.MPESA_SHORTCODE || '',
    passkey: process.env.MPESA_PASSKEY || '',
    b2cShortcode: process.env.MPESA_B2C_SHORTCODE || '',
    initiatorName: process.env.MPESA_INITIATOR_NAME || '',
    securityCredential: process.env.MPESA_SECURITY_CREDENTIAL || '',
    timeoutUrl: process.env.MPESA_TIMEOUT_URL || '',
  },
  africasTalking: {
    username: process.env.AT_USERNAME || '',
    apiKey: process.env.AT_API_KEY || '',
    senderId: process.env.AT_SENDER_ID || '',
  },
}

export function requireDatabaseUrl() {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required. Set DEMO_MODE=true only for provider mocks, not database access.')
  }
}
