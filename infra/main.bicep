@description('Globally unique name for this new DEV/TEST PostgreSQL server.')
@minLength(3)
@maxLength(63)
param serverName string

@description('Customer region: West US 2. Confirm PostgreSQL Standard_B1ms capacity in this subscription.')
param location string = 'westus2'

@description('Entra administrator object ID for bootstrap; never the web runtime identity.')
param administratorObjectId string

@description('Entra administrator display name or UPN.')
param administratorName string

@allowed([
  'User'
  'Group'
  'ServicePrincipal'
])
param administratorType string = 'User'

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2026-10-01' = {
  name: serverName
  location: location
  tags: {
    purpose: 'app-service-builder-postgresql-devtest'
  }
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    createMode: 'Create'
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: subscription().tenantId
    }
    storage: {
      storageSizeGB: 32
      autoGrow: 'Disabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
  }
}

resource administrator 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2026-10-01' = {
  parent: server
  name: administratorObjectId
  properties: {
    principalName: administratorName
    principalType: administratorType
    tenantId: subscription().tenantId
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2026-10-01' = {
  parent: server
  name: 'shopstream'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

output serverId string = server.id
output host string = server.properties.fullyQualifiedDomainName
output databaseName string = database.name
