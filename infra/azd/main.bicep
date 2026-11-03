targetScope = 'subscription'

@minLength(3)
@maxLength(20)
param environmentName string
param location string
param resourceGroupName string
param ownerId string
param appName string
param createBuilderApp bool
param postgresqlLocation string
param postgresqlServerName string
param administratorObjectId string
param administratorName string
@allowed(['User', 'Group'])
param administratorType string = 'User'
param bootstrapIpv4 string = ''
param allowAzureServices bool = false

resource group 'Microsoft.Resources/resourceGroups@2025-04-01' = {
  name: resourceGroupName
  location: location
  tags: {
    'azd-env-name': environmentName
    'shopstream-owner-id': ownerId
  }
}

module resources './resources.bicep' = {
  name: 'shopstream-resources'
  scope: group
  params: {
    location: location
    appName: appName
    createBuilderApp: createBuilderApp
    postgresqlLocation: postgresqlLocation
    postgresqlServerName: postgresqlServerName
    administratorObjectId: administratorObjectId
    administratorName: administratorName
    administratorType: administratorType
    bootstrapIpv4: bootstrapIpv4
    allowAzureServices: allowAzureServices
    ownerId: ownerId
    environmentName: environmentName
  }
}

output AZURE_RESOURCE_GROUP string = group.name
output BUILDER_APP_NAME string = appName
output BUILDER_APP_RESOURCE_ID string = resources.outputs.appId
output PG_SERVER_ID string = resources.outputs.serverId
output PGHOST string = resources.outputs.host
output PGDATABASE string = resources.outputs.databaseName
output PGUSER string = 'shopstream_runtime'
