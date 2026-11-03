# ShopStream: App Service Builder + Azure Database for PostgreSQL

ShopStream is a React marketplace and operations dashboard backed by Express,
`pg`, and a separately provisioned **Azure Database for PostgreSQL Flexible
Server**. Explore products, vendors, orders, reviews, and analytics. All SQL
queries run server-side using **Microsoft Entra tokens**, never a stored database
password. The default hosted credential is the app's system-assigned managed
identity; local development uses Azure CLI authentication.

**App Service Builder is Private Preview. This is an unauthenticated DEV/TEST
demo, not an e-commerce production system.** Database authentication does not
authenticate website visitors. Writes are disabled by default. When explicitly
enabled, every visitor can create orders, advance fulfillment, and create/delete
demo reviews. Do not use real customer data or expose an enabled-write demo to an
untrusted audience.

**Qualification (2026-11-03):** twelve unit tests, local PostgreSQL SQL CRUD/
persistence/privilege checks over verified TLS, frontend packaging, and Edge UI
workflows passed. A hosted custom build succeeded on Node.js 24 with Express
framework detection. Its subsequent startup readiness check timed out
(`started=True`, `ready=False`, `AppStartupFailed`); no active runtime was
established. The exact startup cause remains unconfirmed. Separately, Azure
PostgreSQL provisioning and local Entra token acquisition succeeded, but the
workstation database connection reset before TLS, preventing cloud bootstrap
and Entra SQL mapping. These are **not** deployed managed-identity or
app-to-database qualification. Verify activation, identity delivery, SQL
permissions, sign-in, and the permitted network path on your own preview target
before calling the sample deployed.
No App Service Service Connector, customer VNet integration, private endpoint
route, or stable outbound IP contract is assumed.

## Screenshots

These captures use the actual app with an isolated **local PostgreSQL fixture
and verified TLS**. They do not demonstrate Azure database authentication,
Builder activation, or deployed managed-identity connectivity. Names and
`example.com` addresses are generated demo data.

| Workflow | Capture |
| --- | --- |
| Seeded marketplace dashboard | [Dashboard](docs/images/shopstream-dashboard.png) |
| Product browsing | [Product catalog](docs/images/shopstream-products.png) |
| Place Test Order, then Mark processing | [Order workflow](docs/images/shopstream-orders.png) |

## Prerequisites

- Node.js **24.x** and npm, Git, Azure CLI, and its Bicep component.
- An authorized Azure subscription/tenant, PostgreSQL provisioning rights,
  and an Entra user or group authorized to administer this dedicated database.
- Builder preview access with **Node.js compute activation** supported in the
  chosen location; an authorized GitHub source repository.
- A database network path that is explicitly permitted from your workstation
  and, independently, from the deployed Builder app. A laptop connection does
  not qualify the latter.

See the maintained [manifest reference](https://builder.appservice.azure.com/docs/reference/builder-yaml/),
[runtimes](https://builder.appservice.azure.com/docs/reference/runtimes/),
[managed identity guide](https://builder.appservice.azure.com/docs/guides/managed-identity/),
and [service connection checklist](https://builder.appservice.azure.com/docs/guides/connect-to-services/).

## 1. Provision the database dependency

Use a new, dedicated PostgreSQL server and database. The template creates
**Standard_B1ms / Burstable**, PostgreSQL 16, **32 GiB**, seven-day locally
redundant backup, no HA, no automatic storage growth, and **Entra-only**
authentication. It creates no passwords or firewall rules. The public endpoint
is restricted until an explicit permitted IP is added.

Replace placeholders; retain your selected subscription on **every** Azure
command. Do not change the CLI default subscription just for this example.

```sh
export AZURE_SUBSCRIPTION_ID="<subscription-id>"
export AZURE_TENANT_ID="<tenant-id>"
export RG="<your-owned-devtest-resource-group>"
export PG_SERVER="asb-pg-<globally-unique-suffix>"
export PG_LOCATION="<postgresql-enabled-location>"
export ADMIN_OBJECT_ID="<entra-bootstrap-admin-object-id>"
export ADMIN_NAME="<entra-bootstrap-admin-upn-or-group-name>"

az login --tenant "$AZURE_TENANT_ID"
az account show --subscription "$AZURE_SUBSCRIPTION_ID" --query '{name:name,tenantId:tenantId}'
az postgres flexible-server list-skus --location "$PG_LOCATION" --subscription "$AZURE_SUBSCRIPTION_ID"

# Create a dedicated group only if you do not already have an approved one.
az group create --name "$RG" --location "$PG_LOCATION" --subscription "$AZURE_SUBSCRIPTION_ID"

az deployment group what-if --name asb-pg-dependency --resource-group "$RG" \
  --subscription "$AZURE_SUBSCRIPTION_ID" --template-file infra/main.bicep \
  --parameters serverName="$PG_SERVER" location="$PG_LOCATION" \
    administratorObjectId="$ADMIN_OBJECT_ID" administratorName="$ADMIN_NAME"

# Review the changes and cost before this creates a billable dependency.
az deployment group create --name asb-pg-dependency --resource-group "$RG" \
  --subscription "$AZURE_SUBSCRIPTION_ID" --template-file infra/main.bicep \
  --parameters serverName="$PG_SERVER" location="$PG_LOCATION" \
    administratorObjectId="$ADMIN_OBJECT_ID" administratorName="$ADMIN_NAME"
```

Use `administratorType=Group` when your bootstrap administrator is an Entra
group. The runtime managed identity must **not** be this administrator.
Record the deployment's `serverId`, `host`, and `databaseName` outputs.
Region availability is subscription-specific: a SKU listing alone is not a
capacity guarantee.

For an approved workstation connection to **this new test server only**, use
one exact public IPv4, never `0.0.0.0`, a broad range, or “allow Azure services.”
Do not alter an existing service's restrictions:

```sh
export BOOTSTRAP_IPV4="<approved-workstation-public-ipv4>"
node -e 'const {isIPv4}=require("node:net"); const ip=process.env.BOOTSTRAP_IPV4; if(!isIPv4(ip)||ip==="0.0.0.0") throw Error("One explicit nonzero IPv4 is required")'
az postgres flexible-server firewall-rule create --server-name "$PG_SERVER" --resource-group "$RG" \
  --name bootstrap-workstation --start-ip-address "$BOOTSTRAP_IPV4" \
  --end-ip-address "$BOOTSTRAP_IPV4" --subscription "$AZURE_SUBSCRIPTION_ID"
```

**Stop if Builder cannot reach PostgreSQL under the permitted rules.** Request a
supported preview network path from the Builder team. A private endpoint does
not automatically connect Builder to a VNet; opening PostgreSQL to all Azure
traffic is not a workaround.

## 2. Bootstrap schema and demo data as the administrator

```sh
npm ci
export PGHOST="$PG_SERVER.postgres.database.azure.com"
export PGDATABASE=shopstream
export PGUSER="$ADMIN_NAME"
export ENTRA_CREDENTIAL=azure-cli
npm run db:bootstrap
```

The Azure Identity SDK invokes Azure CLI with the explicit subscription,
checks the returned token's tenant against `AZURE_TENANT_ID`, gets the
PostgreSQL audience token, and supplies it through
`pg`'s async password callback. Tokens are never printed or saved. Clear legacy
`DATABASE_URL`, `PGPASSWORD`, and `PGSSLMODE` settings before running: the sample
rejects password/URL authentication and unsafe TLS overrides.

`db/schema.sql` preserves the original eight-table marketplace schema.
`db/seed.sql` installs 10 vendors, 15 categories, 500 products, 200 customers,
300 orders, 900 order items, 400 reviews, and 200 inventory events.
`db/setup.js` wraps schema and seed in one transaction with a shared advisory
lock and a version marker. Bootstrap requires an **empty dedicated database**;
it refuses to merge seed into unrelated tables. Rerunning the command returns
“already installed” without duplicating data or overwriting orders. Do not run
`seed.sql` directly: it relies on fresh IDs and is not independently idempotent.
The seed is synthetic demonstration data, not a reconciled accounting ledger.

To deliberately restore the entire synthetic dataset, stop the demo app first,
connect as the bootstrap administrator, and explicitly confirm the database:

```sh
SHOPSTREAM_CONFIRM_RESET="$PGDATABASE" npm run db:reset
```

This replaces **all eight tables' data**, resets sequences, and reseeds within
one transaction. It uses no `CASCADE`. `POST /api/reset` always returns **403**;
the web identity has no `TRUNCATE`, schema ownership, or migration privileges.
Only use reset on this dedicated sample database.

## 3. Map least-privilege Entra runtime and developer principals

Enable a **system-assigned identity** on the Builder app's Identity page and
choose **Save and deploy**. Record its **principal/object ID**. Identity
assignment alone grants neither SQL permissions nor network access. If the
first app deployment cannot pass health before granting database access, save
the identity, map it below, and retry the deployment after configuration.

While still connected as the bootstrap administrator:

```sh
export RUNTIME_ROLE=shopstream_runtime
export RUNTIME_OBJECT_ID="<builder-system-assigned-principal-id>"
export RUNTIME_OBJECT_TYPE=service
npm run db:grant
```

`db:grant` connects separately to the **postgres** database to call
`pgaadauth_create_principal_with_oid`, then grants permissions in **shopstream**.
It verifies an existing mapping rather than silently replacing it. Entra
**object IDs** map SQL identities; client IDs select credentials; Azure resource
IDs attach user-assigned identities. They are not interchangeable.

The essential SQL is shown below for review; the script quotes identifiers and
validates inputs. Run the mapping in `postgres` as an Entra administrator:

```sql
SELECT * FROM pgaadauth_create_principal_with_oid(
  'shopstream_runtime', '<runtime-object-id>', 'service', FALSE, FALSE);
```

Reconnect to `shopstream` as the administrator for the grants:

```sql
REVOKE ALL ON DATABASE shopstream FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE shopstream TO shopstream_runtime;
GRANT USAGE ON SCHEMA public TO shopstream_runtime;
GRANT SELECT ON vendors, categories, products, customers, orders,
  order_items, reviews, inventory_events TO shopstream_runtime;
GRANT INSERT ON orders, order_items, reviews, inventory_events TO shopstream_runtime;
GRANT UPDATE (stock_qty, rating_avg, review_count, updated_at) ON products TO shopstream_runtime;
GRANT UPDATE (status, updated_at) ON orders TO shopstream_runtime;
GRANT DELETE ON reviews TO shopstream_runtime;
GRANT USAGE ON SEQUENCE orders_id_seq, order_items_id_seq,
  reviews_id_seq, inventory_events_id_seq TO shopstream_runtime;
```

There is no `azure_pg_admin` membership, `CREATEDB`, `CREATEROLE`, table
ownership, broad default privileges, `TRUNCATE`, or schema write access.
Azure Contributor/Reader roles do **not** grant PostgreSQL data access.
Future schema versions must explicitly review new grants.

For local development, run `db:grant` once more as the administrator with
`RUNTIME_ROLE=shopstream_developer`, your developer user's object ID, and
`RUNTIME_OBJECT_TYPE=user`. Then change **PGUSER** to `shopstream_developer`
before running the web app. Do not run the web app with the admin SQL login.

### User-assigned alternative

Create a separate user-assigned identity in your approved group if you need a
stable identity independent of the app lifecycle:

```sh
az identity create --name asb-pg-runtime --resource-group "$RG" \
  --location "$PG_LOCATION" --subscription "$AZURE_SUBSCRIPTION_ID"
```

Attach its returned **resource ID** on Builder's Identity page. Map its
**principal ID** with `db:grant`, and set **AZURE_CLIENT_ID** to its **client ID**
in Builder Variables. Choose **Save and deploy**, and verify the new version.
For the default system-assigned path, leave `AZURE_CLIENT_ID` unset.
The server uses explicit `ManagedIdentityCredential`; it cannot silently fall
back to a developer login or environment client secret when hosted.

## 4. Run and verify locally

Copy `.env.example` to the ignored `.env` and fill the nonsecret connection
settings. Use your limited **developer** SQL role and explicit tenant and
subscription. Environment files are not automatically loaded by npm scripts.

Azure CLI token acquisition accepts either `--subscription` or `--tenant`,
not both. The sample uses the explicit subscription and verifies tenant
selection from the trusted SDK token output; `az login --tenant` selects the
intended directory before you run it.

```sh
npm test
npm run build
HOST=127.0.0.1 PORT=8186 node --env-file=.env server/index.js
```

Open `http://127.0.0.1:8186` in Microsoft Edge. `/health` queries PostgreSQL and
returns **200** only when connectivity/authentication succeed, otherwise **503**.
The dashboard, products, vendors, and analytics must display actual seeded
database rows; a rendered shell alone is not verification.

To exercise mutations in this isolated demo, stop the server, add
`SHOPSTREAM_ENABLE_DEMO_WRITES=true` to `.env`, and restart. Orders exposes
**Place Test Order** and one-step fulfillment actions; product details exposes
review creation/deletion. Errors are displayed rather than reported as success.

An API-level CRUD/persistence walkthrough (requires opt-in writes):

```sh
export APP_URL=http://127.0.0.1:8186
curl --fail "$APP_URL/health"
curl --fail "$APP_URL/api/products?limit=2"
curl --fail -H 'Content-Type: application/json' -d \
  '{"customer_id":1,"items":[{"product_id":1,"quantity":1}]}' "$APP_URL/api/orders"
# Replace <order-id> with the response ID; read and update that same row.
curl --fail "$APP_URL/api/orders/<order-id>"
curl --fail -X PATCH -H 'Content-Type: application/json' \
  -d '{"status":"processing"}' "$APP_URL/api/orders/<order-id>"
curl --fail -H 'Content-Type: application/json' -d \
  '{"product_id":1,"customer_id":1,"rating":5,"title":"Demo persistence review"}' "$APP_URL/api/reviews"
# Product read shows the new review and updated aggregate; delete only its returned ID.
curl --fail "$APP_URL/api/products/1"
curl --fail -X DELETE "$APP_URL/api/reviews/<review-id>"
```

Restart the app and read the same order ID: its status must remain `processing`
and product stock must remain decremented. Orders, stock, items, and inventory
events commit atomically. Duplicate product IDs are combined; row locks prevent
overselling. Quantities are integers 1–100, at most 20 product lines, and totals
are bounded. Transactions share an advisory lock across replicas. Demo limits:
**1,000 orders, 1,000 reviews, 5,000 inventory events** (including seed).
Reaching a limit returns **409**, never auto-resets or deletes data.

Integration tests require a real seeded PostgreSQL database and an explicitly
confirmed dedicated test target; see `test/integration/crud.test.js`. They create
one order, advance its status, and create/delete their own review. No
production fallback or in-memory database is used.

## 5. Deploy your committed source with Builder

Fork the published sample into an authorized GitHub account, or publish this
source to the approved sample repository. Select the **repository root** and
your committed branch in [Builder Portal](https://builder.appservice.azure.com/).
Do not point Builder at the original legacy deployment manifest.

The root `builder.yaml` declares exactly one **web** component, Node.js **24**,
`run.start: node server/index.js`, and health path `/health`. It retains the
default port **8080** and mount `/`. The root package contains only the Express/
PostgreSQL backend dependencies. Vite, React, its config, and its own lockfile
live under **client/**. This separation is important: a root Vite dependency or
config can classify the root as Vite and reject `role: web`/`run`, even with a
custom build. The **explicit custom compute build** is:

```text
npm ci && npm run build && npm run package
```

The root build script installs the locked client dependencies and builds the
frontend from `client/` into root `dist/`; the root has no Vite framework
evidence. Do not move the frontend dependencies/config back to the root.
The packaging script stages `server`, `dist`, installed dependencies, and
package metadata under Builder's **$DESTINATION_DIR**. The runnable artifact is
self-contained; it does not require source-relative `../client`, database
bootstrap scripts, or a privileged build-time connection. There is no static
`output`, legacy `dependencies`, automatic database migration, or
`startCommand` field. Never set reserved `PORT` in Builder Variables.

Set these runtime variables:

| Variable | Value |
| --- | --- |
| `PGHOST` | The provisioned server FQDN |
| `PGDATABASE` | `shopstream` |
| `PGUSER` | `shopstream_runtime`, mapped to the actual runtime identity |
| `ENTRA_CREDENTIAL` | `managed-identity` (also the default) |
| `AZURE_CLIENT_ID` | Unset for system-assigned; client ID for user-assigned |
| `SHOPSTREAM_ENABLE_DEMO_WRITES` | Unset/false initially; true only for a bounded trusted demo |

Choose **Save and deploy** to capture variables in a new version. **Save only**
does not update running code. Retained versions use historical settings. Wait
for successful deployment, then repeat `/health`, dashboard reads, CRUD, and
restart/redeploy persistence checks against the **actual runtime URL**. This is
the qualification required for deployed managed identity and network access.
The CI workflow runs local tests/build only; it does not deploy or bootstrap.

## Authentication, TLS, errors, and troubleshooting

`server/db/config.js` passes the async password function to `pg`, which invokes
it for **each new physical connection**, including connections created after
token expiry. The SDK manages caching/refresh; existing connections are not
re-authenticated per query. Pool size is five, idle timeout 30 seconds,
connection timeout 15 seconds, query/statement deadlines are bounded, and
connections rotate after 30 minutes. SQL mutations are never automatically
retried: a lost commit response needs reconciliation, not duplicate orders.

TLS always uses **rejectUnauthorized: true**, with hostname verification and
Node's trusted CA roots. If your documented CA requirements need a custom
bundle, set **PGSSLROOTCERT** to its server-side PEM path; that bundle must be
present in the runtime artifact. Never use `sslmode=require` as a substitute
for certificate verification, `rejectUnauthorized: false`, or
`NODE_TLS_REJECT_UNAUTHORIZED=0`.

| Symptom | Check |
| --- | --- |
| Missing configuration at startup | Supply PGHOST/PGDATABASE/PGUSER; remove legacy URL/password/TLS overrides |
| Local credential failure | Correct `az login`, explicit tenant/subscription, `ENTRA_CREDENTIAL=azure-cli` |
| Hosted credential failure | Identity is deployed; correct AZURE_CLIENT_ID selection; preview credential delivery support |
| Role does not exist/token rejected | Map principal in `postgres`, verify object ID, SQL PGUSER, tenant, and PostgreSQL audience |
| Permission denied | Runtime grants in `shopstream`, not just ARM roles or another database |
| DNS/timeout | Approved network path and firewall; do not weaken restrictions to mask failure |
| Connection resets before TLS | Investigate the permitted transport path independently of token/password selection; server Ready and matching firewall rules do not prove SQL/TLS reachability |
| TLS certificate error | FQDN and supported trusted CA bundle; never disable verification |
| 403 on mutations | Writes default off; foreign browser origins rejected; reset always forbidden |
| 409 | Stock, fulfillment transition, or bounded dataset limit; reconcile before retry |
| Saved settings have no effect | Deploy a new version and verify its variables, identity, and active source |
| Build succeeds, activation fails | Confirm Node.js compute support for this Builder target |
| AppStartupFailed/readiness timeout | Inspect the exact startup/deployment diagnostics and `/health`; successful build or process start is not database or serving qualification |

Server logs include request path and error **code/name**, not tokens, full
connection strings, raw PostgreSQL error details, or customer payloads.
Client dependency errors return a bounded **503** with troubleshooting context.
Graceful shutdown closes HTTP and database pools.

## Costs and cleanup

Check [PostgreSQL pricing](https://azure.microsoft.com/pricing/details/postgresql/flexible-server/)
for your region and agreement before provisioning. An illustrative East US 2
retail lookup on 2026-11-03 returned **B1MS $0.017/hour** and managed storage
**$0.115/GiB-month**: approximately **$16.09/month** for 730 compute hours and
32 GiB, excluding excess backups, transfer, taxes, and Builder charges.
This is not a quote or a zero-cost guarantee. B1ms has limited CPU credits and
memory; use this bounded dataset rather than a million-row seed.

Stop local processes with Ctrl+C. When finished, delete only the owned Builder
sample app through Portal and confirm deletion. App deletion does **not**
delete PostgreSQL or a user-assigned identity. After separately approving
dependency cleanup:

```sh
az postgres flexible-server delete --name "$PG_SERVER" --resource-group "$RG" \
  --subscription "$AZURE_SUBSCRIPTION_ID"
# Only if you created this optional identity for the sample:
az identity delete --name asb-pg-runtime --resource-group "$RG" \
  --subscription "$AZURE_SUBSCRIPTION_ID"
```

Remove the workstation firewall rule when no longer needed:

```sh
az postgres flexible-server firewall-rule delete --server-name "$PG_SERVER" --resource-group "$RG" \
  --name bootstrap-workstation --subscription "$AZURE_SUBSCRIPTION_ID"
```

Do **not** delete a shared resource group, unrelated resources, or source forks
as incidental cleanup. Record all sample-created IDs and remove them explicitly.
Deleting a system-assigned app identity does not automatically remove its SQL
mapping: revoke/drop the unused role as an administrator if reusing the server.

## References

This sample is licensed under [MIT](LICENSE.md). See
[CONTRIBUTING.md](CONTRIBUTING.md) and [security reporting](.github/SECURITY.md).

- [Azure PostgreSQL Entra setup](https://learn.microsoft.com/azure/postgresql/security/security-entra-configure)
- [PostgreSQL Entra principal functions](https://learn.microsoft.com/azure/postgresql/security/security-manage-entra-users)
- [Azure Identity SDK](https://learn.microsoft.com/javascript/api/overview/azure/identity-readme)
- [node-postgres async password callbacks](https://node-postgres.com/features/connecting)
- [PostgreSQL Flexible Server Bicep reference](https://learn.microsoft.com/azure/templates/microsoft.dbforpostgresql/flexibleservers)
- [Builder manifest reference](https://builder.appservice.azure.com/docs/reference/builder-yaml/)
- [Builder network boundaries](https://builder.appservice.azure.com/docs/guides/networking/)
