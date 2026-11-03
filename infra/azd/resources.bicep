param location string
param appName string
param createBuilderApp bool
param postgresqlLocation string
param postgresqlServerName string
param administratorObjectId string
param administratorName string
param administratorType string
param bootstrapIpv4 string
param allowAzureServices bool
param ownerId string
param environmentName string

// Avoid an identity/configuration PUT on an already provisioned Builder app.
resource app 'Microsoft.Web/builderApps@2026-09-01-preview' = if (createBuilderApp) {
  name: appName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  tags: {
    'azd-env-name': environmentName
    'shopstream-owner-id': ownerId
  }
  properties: {}
}

module postgresql '../main.bicep' = {
  name: 'shopstream-postgresql'
  params: {
    serverName: postgresqlServerName
    location: postgresqlLocation
    administratorObjectId: administratorObjectId
    administratorName: administratorName
    administratorType: administratorType
  }
}

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2026-10-01' existing = {
  name: postgresqlServerName
}

resource workstation 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2026-10-01' = if (!empty(bootstrapIpv4)) {
  parent: server
  name: 'bootstrap-workstation'
  properties: {
    startIpAddress: bootstrapIpv4
    endIpAddress: bootstrapIpv4
  }
  dependsOn: [postgresql]
}

resource azureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2026-10-01' = if (allowAzureServices) {
  parent: server
  name: 'devtest-allow-azure-services'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
  dependsOn: [postgresql]
}

output appId string = resourceId('Microsoft.Web/builderApps', appName)
output serverId string = postgresql.outputs.serverId
output host string = postgresql.outputs.host
output databaseName string = postgresql.outputs.databaseName
