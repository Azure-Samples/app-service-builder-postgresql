const { readFileSync } = require('node:fs');
const { ManagedIdentityCredential, AzureCliCredential } = require('@azure/identity');

const SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';

function createConfig(env = process.env, credential) {
  for (const key of ['PGHOST', 'PGDATABASE', 'PGUSER']) {
    if (!env[key]) throw new Error(`${key} is required; see the PostgreSQL setup in README.md`);
  }
  if (env.DATABASE_URL || env.PGPASSWORD || env.PGSSLMODE || env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new Error('Password/URL authentication and TLS overrides are not supported');
  }
  const mode = env.ENTRA_CREDENTIAL || 'managed-identity';
  if (!['managed-identity', 'azure-cli'].includes(mode)) {
    throw new Error('ENTRA_CREDENTIAL must be managed-identity or azure-cli');
  }
  if (mode === 'azure-cli' && (!env.AZURE_TENANT_ID || !env.AZURE_SUBSCRIPTION_ID)) {
    throw new Error('Local Azure CLI authentication requires AZURE_TENANT_ID and AZURE_SUBSCRIPTION_ID');
  }
  const port = Number(env.PGPORT || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PGPORT is invalid');
  credential ||= mode === 'azure-cli'
    ? new AzureCliCredential({
      subscription: env.AZURE_SUBSCRIPTION_ID,
      processTimeoutInMs: 10000,
    })
    : new ManagedIdentityCredential(env.AZURE_CLIENT_ID ? { clientId: env.AZURE_CLIENT_ID } : {});
  return {
    host: env.PGHOST,
    database: env.PGDATABASE,
    user: env.PGUSER,
    port,
    // pg invokes this for each new physical connection; the Azure SDK owns token caching.
    password: async () => {
      const token = await credential.getToken(SCOPE, { abortSignal: AbortSignal.timeout(10000) });
      if (!token?.token || !Number.isFinite(token.expiresOnTimestamp) || token.expiresOnTimestamp <= Date.now() + 30000) {
        throw new Error('Entra credential did not return a usable PostgreSQL token');
      }
      if (mode === 'azure-cli') {
        let tenant;
        try {
          tenant = JSON.parse(Buffer.from(token.token.split('.')[1], 'base64url').toString()).tid;
        } catch {
          throw new Error('Azure CLI returned a token without readable tenant metadata');
        }
        // This checks trusted SDK output selection, not the signature of an inbound user token.
        if (typeof tenant !== 'string' || tenant.toLowerCase() !== env.AZURE_TENANT_ID.toLowerCase()) {
          throw new Error('Azure CLI token tenant does not match AZURE_TENANT_ID');
        }
      }
      return token.token;
    },
    ssl: {
      rejectUnauthorized: true,
      ...(env.PGSSLROOTCERT ? { ca: readFileSync(env.PGSSLROOTCERT, 'utf8') } : {}),
    },
    max: 5,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
    maxLifetimeSeconds: 1800,
    statement_timeout: 10000,
    query_timeout: 15000,
    application_name: 'shopstream',
  };
}

module.exports = { createConfig, SCOPE };
