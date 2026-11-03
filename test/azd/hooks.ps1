$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../../scripts/azd.ps1" -Library
$script:Checks = 0
function Check([bool] $Condition, [string] $Message) {
    if (-not $Condition) { throw $Message }
    $script:Checks++
}
function Reject([scriptblock] $Call, [string] $Pattern) {
    $rejected = $false
    try { & $Call } catch {
        if ($_.Exception.Message -notmatch $Pattern) { throw }
        $rejected = $true
    }
    Check $rejected "Expected rejection: $Pattern"
}

$script:Config = @{
    env = 'offline'; subscription = '11111111-1111-4111-8111-111111111111'
    tenant = '22222222-2222-4222-8222-222222222222'; location = 'eastus2'; pgLocation = 'westus2'
    pg = 'asb-pg-offline'; group = 'rg-offline'; app = 'asb-offline'; admin = '33333333-3333-4333-8333-333333333333'
    adminName = 'admin'; adminType = 'User'; ip = '192.0.2.1'; allowAzure = $true
    testers = @('33333333-3333-4333-8333-333333333333'); repository = 'owner/fork'; branch = 'main'; account = 'owner'
    appId = '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/rg-offline/providers/Microsoft.Web/builderApps/asb-offline'
    pgId = '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/rg-offline/providers/Microsoft.DBforPostgreSQL/flexibleServers/asb-pg-offline'
    base = '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/rg-offline'
}
$script:State = @{ version = 1; owner = '44444444-4444-4444-8444-444444444444'; targetHash = Digest (Get-Target) }
Assert-State
$script:State.targetHash = 'drift'
Reject { Assert-State } 'Missing ownership'
$script:State.targetHash = Digest (Get-Target)
$script:State.owner = 'not-a-guid'
Reject { Assert-State } 'Invalid ownership'
$script:State.owner = '44444444-4444-4444-8444-444444444444'

foreach ($url in @('https://evil.invalid/anything', 'http://management.azure.com/', 'https://management.azure.com:444/',
    'https://management.azure.com/subscriptions/other/op', 'https://user@management.azure.com/')) {
    Reject { Assert-OperationUrl $url } 'Untrusted operation'
}
Assert-OperationUrl "https://management.azure.com/subscriptions/$($script:Config.subscription)/providers/Microsoft.Web/locations/eastus2/builderOperationStatuses/offline"
$script:Checks++

$app = @{ properties = @{ sourceIntegrationState = 'Configured'; source = @{ provider = 'github'; id = '123'; displayName = 'owner/fork'; reference = 'main'; rootDirectory = '.'; autoDeploy = $false } } }
Assert-Source $app '123'
$script:Checks++
foreach ($rootDirectory in @('', $null)) {
    $app.properties.source.rootDirectory = $rootDirectory
    Assert-Source $app '123'
    $script:Checks++
}
$app.properties.source.rootDirectory = '.'
$source = $app.properties.source.Clone()
$app.properties.source.Remove('rootDirectory')
$app.properties.source.Remove('autoDeploy')
Assert-Source $app '123'
$script:Checks++
$app.properties.source = $source
foreach ($change in @(@{ id = '456' }, @{ reference = 'other' }, @{ rootDirectory = 'other' },
    @{ rootDirectory = ' ' }, @{ autoDeploy = $true })) {
    $source = $app.properties.source.Clone()
    foreach ($key in $change.Keys) { $app.properties.source[$key] = $change[$key] }
    Reject { Assert-Source $app '123' } 'Source|Automatic'
    $app.properties.source = $source
}
$app.properties.sourceIntegrationState = 'Pending'
Reject { Assert-Source $app '123' } 'Source'
$app.properties.sourceIntegrationState = 'Configured'

$native = Invoke-Tool node @('-e', 'console.log(JSON.stringify(process.argv.slice(1)))', 'argument with spaces', 'quote"value')
$parsed = $native.output | ConvertFrom-Json
Check ($parsed[0] -ceq 'argument with spaces' -and $parsed[1] -ceq 'quote"value') 'Native argument forwarding corrupted'
Reject { Invoke-Tool node @('-e', 'process.exit(7)') } 'exit 7'
Reject { Invoke-Tool node @('-e', 'setTimeout(()=>{},10000)') -Timeout 1 } 'timed out'
$failedStatus = @('-e', 'console.log(JSON.stringify({status:"Failed",error:{code:"AppRuntimeIdentityMismatch"}}));process.exit(1)')
Reject { Invoke-Json node $failedStatus } 'exit 1'
$parsedStatus = Invoke-Json node $failedStatus -AllowTerminalFailure
Check ($parsedStatus.status -ceq 'Failed' -and $parsedStatus.error.code -ceq 'AppRuntimeIdentityMismatch') 'Terminal CLI failure details were lost'
$parsedStatus = Invoke-Json node @('-e', 'console.log(JSON.stringify({status:"Canceled"}));process.exit(1)') -AllowTerminalFailure
Check ($parsedStatus.status -ceq 'Canceled') 'Terminal CLI cancellation was lost'
Reject { Invoke-Json node @('-e', 'console.log(JSON.stringify({status:"Succeeded"}));process.exit(1)') -AllowTerminalFailure } 'without a terminal failure'
Reject { Invoke-Json node @('-e', 'console.log(JSON.stringify({error:"unavailable"}));process.exit(1)') -AllowTerminalFailure } 'without a terminal failure'
Reject { Invoke-Json node @('-e', 'console.log("not JSON");process.exit(1)') -AllowTerminalFailure } 'invalid JSON'

$oldConfig = $script:Config
$oldState = $script:State
$script:Inputs = @{
    AZURE_SUBSCRIPTION_ID = $oldConfig.subscription; AZURE_TENANT_ID = $oldConfig.tenant; AZURE_LOCATION = $oldConfig.location
    PG_LOCATION = $oldConfig.pgLocation; PG_SERVER = $oldConfig.pg; ADMIN_OBJECT_ID = $oldConfig.admin; ADMIN_NAME = 'admin'
    GITHUB_REPOSITORY = 'owner/fork'; GITHUB_REF_NAME = 'main'; GITHUB_SHA = ('a' * 40); GITHUB_ACCOUNT = 'owner'
    BUILDER_ALLOWED_OBJECT_IDS = $oldConfig.admin; SHOPSTREAM_ALLOW_AZURE_SERVICES = 'true'; SHOPSTREAM_ENABLE_DEMO_WRITES = 'false'
    SAMPLE_INTERNAL_TEST_ALLOW_EASTUS2 = 'true'
}
function Invoke-Json { return $script:Inputs }
$script:Environment = 'offline'
$env:SHOPSTREAM_PUBLIC_ORIGIN = 'https://stale.invalid'
$null = Get-Config
Check (-not (Test-Path Env:SHOPSTREAM_PUBLIC_ORIGIN)) 'Missing optional origin became an empty configured origin instead of being removed'
$null = $script:Inputs.Remove('AZURE_LOCATION')
$null = $script:Inputs.Remove('PG_LOCATION')
$null = $script:Inputs.Remove('SAMPLE_INTERNAL_TEST_ALLOW_EASTUS2')
$defaults = Get-Config
Check ($defaults.location -ceq 'westus2' -and $defaults.pgLocation -ceq 'westus2' -and -not (Test-Path Env:SAMPLE_INTERNAL_TEST_ALLOW_EASTUS2)) 'Named environment did not default to customer WestUS2 or retained an inherited internal override'
$script:Environment = $null
$script:Config = $oldConfig
$script:State = $oldState

function Save-State { $script:Saved = $true }
function Set-Output { param($Name, $Value) }
function Invoke-Json { throw 'Unexpected external command in recovery fixture' }
$script:State['operation'] = @{ status = 'AdmissionUnknown'; requestId = 'offline' }
Reject { Complete-Operation } 'Admission outcome unknown'
$script:State.operation = @{ status = 'Failed'; url = "https://management.azure.com/subscriptions/$($script:Config.subscription)/operation/offline" }
Reject { Complete-Operation } 'Previous rollout failed'

$script:State['provisioned'] = $true
$script:Rules = @(
    @{ name = 'bootstrap-workstation'; properties = @{ startIpAddress = '192.0.2.1'; endIpAddress = '192.0.2.1' } },
    @{ name = 'devtest-allow-azure-services'; properties = @{ startIpAddress = '0.0.0.0'; endIpAddress = '0.0.0.0' } }
)
$savedAdmin = @{
    id = "$($script:Config.pgId)/administrators/$($script:Config.admin)"
    name = $script:Config.adminName
    properties = @{
        objectId = $script:Config.admin; tenantId = $script:Config.tenant
        principalType = $script:Config.adminType; principalName = $script:Config.adminName
    }
}
$script:Admins = @($savedAdmin)
$script:PageLink = $null
function Invoke-Json {
    param($Tool, $Arguments)
    if ($Arguments -contains 'group') { return @{ tags = @{ 'shopstream-owner-id' = $script:State.owner; 'azd-env-name' = $script:Config.env } } }
    if ($Arguments -contains 'resource') { return @() }
    throw 'Unexpected inventory command'
}
function Arm {
    param($Method, $Id, [switch]$Allow404)
    if ($Id -ceq $script:Config.pgId) { return @{ body = @{ properties = @{ authConfig = @{ passwordAuth = 'Disabled'; activeDirectoryAuth = 'Enabled'; tenantId = $script:Config.tenant } } } } }
    if ($Id.EndsWith('/firewallRules')) { return @{ body = @{ value = $script:Rules; nextLink = $script:PageLink } } }
    if ($Id.EndsWith('/databases')) { return @{ body = @{ value = @(@{ name = 'shopstream' }) } } }
    if ($Id.EndsWith('/administrators')) { return @{ body = @{ value = $script:Admins } } }
    throw 'Unexpected inventory URL'
}
Assert-Inventory
$script:Checks++
$savedRules = $script:Rules
$script:Rules = @()
Reject { Assert-Inventory } 'Required approved firewall rule'
$script:Rules = $savedRules
$script:Rules[0].properties.endIpAddress = '192.0.2.2'
Reject { Assert-Inventory } 'Firewall drift'
$script:Rules[0].properties.endIpAddress = '192.0.2.1'
$script:PageLink = 'https://untrusted.invalid/next'
Reject { Assert-Inventory } 'inventory is incomplete'
$script:PageLink = $null
$script:Admins = @()
Reject { Assert-Inventory } 'Unknown/missing'
foreach ($change in @(@{ objectId = $script:Config.tenant }, @{ tenantId = $script:Config.admin },
    @{ principalType = 'ServicePrincipal' }, @{ principalName = 'other' })) {
    $properties = $savedAdmin.properties.Clone()
    foreach ($key in $change.Keys) { $properties[$key] = $change[$key] }
    $script:Admins = @(@{ id = $savedAdmin.id; name = $savedAdmin.name; properties = $properties })
    Reject { Assert-Inventory } 'Unknown/missing PostgreSQL administrator'
}
$script:Admins = @(@{ id = "$($script:Config.pgId)/administrators/other"; name = $savedAdmin.name; properties = $savedAdmin.properties })
Reject { Assert-Inventory } 'Unknown/missing PostgreSQL administrator'
$script:Admins = @($savedAdmin)

$script:Policy = @{ mode = 'required'; revision = 1; appliedRevision = 1; propagationPending = $false; primaryBrowserProvider = 'entraId'; entraId = @{
    enabled = $true; applicationMode = 'managed'; tenantIds = @($script:Config.tenant); objectIds = $script:Config.testers
} }
$script:PolicyWrites = 0
function Arm {
    param($Method, $Id, $Body, $Headers)
    if ($Method -ceq 'PUT') {
        Check ($Headers['If-Match'] -ceq '"fixture"') 'Initial policy update lost its ETag guard'
        $script:PolicyWrites++
        $script:Policy = $Body.properties
        $script:Policy['revision'] = 1
        $script:Policy['appliedRevision'] = 1
        $script:Policy['propagationPending'] = $false
    }
    return @{ body = @{ properties = $script:Policy }; etag = '"fixture"' }
}
Assert-Policy
$script:Checks++
$script:Policy.mode = 'optional'
Reject { Assert-Policy } 'tester-only'
$script:Policy.mode = 'required'
$script:Policy.entraId.objectIds = @()
Reject { Assert-Policy } 'tester-only'
$script:Policy.entraId.objectIds = $script:Config.testers
$script:Policy.entraId['emails'] = @('unexpected@example.invalid')
Reject { Assert-Policy } 'tester-only'
$script:Policy.entraId.Remove('emails')
$script:Policy['github'] = @{ enabled = $true }
Reject { Assert-Policy } 'tester-only'
$script:Policy.Remove('github')
Set-Policy
Check ($script:PolicyWrites -eq 0) 'Existing tester policy was overwritten'
$script:Policy = @{ mode = 'disabled'; revision = 0 }
Set-Policy
Check ($script:PolicyWrites -eq 1) 'Untouched disabled revision zero did not receive tester policy'
$script:Policy.mode = 'optional'
Reject { Set-Policy } 'tester-only'
Check ($script:PolicyWrites -eq 1) 'Existing nondefault policy was overwritten'
$script:Policy.mode = 'required'

function Get-App { return @{ body = @{ properties = @{ publicUrl = 'https://offline.app.eastus2.builderapps.dev'; runtime = @{ activeDeploymentId = 'dep_offline'; activeAppVersionId = 'ver_offline' } } } } }
function Get-HealthStatus { return 401 }
Reject { Verify-Health } 'Rollout completed'
function Get-HealthStatus { return 200 }
Reject { Verify-Health } 'unexpected HTTP 200'

$script:State.operation = @{ status = 'Accepted'; url = "https://management.azure.com/subscriptions/$($script:Config.subscription)/operation/offline"; deploymentId = 'dep_offline'; sha = ('a' * 40) }
$script:Polls = 0
$script:ObservedStatus = @{ status = 'Succeeded' }
function Invoke-Tool { return @{ output = 'Usage: builder app version show <name>' } }
function Invoke-Json {
    param($Tool, $Arguments)
    if ($Arguments -contains 'status') { $script:Polls++; return $script:ObservedStatus }
    return @{ status = 'ready'; source = @{ provider = 'github'; revision = ('a' * 40) } }
}
Complete-Operation
Check ($script:State.operation.status -ceq 'Succeeded') 'Accepted operation not resumed'
Complete-Operation
Check ($script:Polls -eq 1) 'Succeeded operation was unnecessarily repolled or readmitted'
$script:State.operation.status = 'Accepted'
$script:ObservedStatus = @{ status = 'Failed'; error = @{ code = 'AppRuntimeIdentityMismatch' } }
Reject { Complete-Operation } 'Builder rollout Failed.*AppRuntimeIdentityMismatch'
Check ($script:State.operation.status -ceq 'Failed' -and $script:State.operation.errorCode -ceq 'AppRuntimeIdentityMismatch') 'Terminal failure was not journaled'
Reject { Complete-Operation } 'Previous rollout failed/canceled'
Check ($script:Polls -eq 2) 'Failed operation was unnecessarily repolled or readmitted'

$script:Deployment = @{ id = '/subscriptions/11111111-1111-4111-8111-111111111111/providers/Microsoft.Resources/deployments/offline'; properties = @{
    parameters = @{ ownerId = @{ value = $script:State.owner }; resourceGroupName = @{ value = 'rg-offline' }; environmentName = @{ value = 'offline' } }
    templateHash = 'template'; outputResources = @(@{ id = $script:Config.base })
} }
function Arm { return @{ body = $script:Deployment } }
$script:Listing = @(@{ id = $script:Deployment.id; name = 'offline-generated'; tags = @{ 'azd-env-name' = 'offline' }; properties = @{ timestamp = '2026-01-01'; provisioningState = 'Succeeded' } })
function Invoke-Json { return $script:Listing }
$selected = Get-CleanupDeployment
Check ($selected.properties.templateHash -ceq 'template') 'Tagged native deployment not selected'
$script:Listing[0].tags['azd-layer-name'] = ''
$selected = Get-CleanupDeployment
Check ($selected.id -ceq $script:Deployment.id) 'Native empty root-layer tag was rejected'
$script:Listing[0].name = 'offline'
foreach ($layer in @('foreign-layer', ' ', $null)) {
    $script:Listing[0].tags['azd-layer-name'] = $layer
    Reject { Get-CleanupDeployment } 'No exact tagged'
}
$script:Listing[0].name = 'offline-generated'
$script:Listing[0].tags.Remove('azd-layer-name')
$script:Deployment.properties.outputResources = @(@{ id = '/subscriptions/other/foreign' })
Reject { Get-CleanupDeployment } 'Foreign resource'
$script:Deployment.properties.outputResources = @(@{ id = $script:Config.base })
$script:Deployment.properties.parameters.ownerId.value = 'foreign'
Reject { Get-CleanupDeployment } 'ownership/parameters'
$script:Deployment.properties.parameters.ownerId.value = $script:State.owner
$script:Listing[0].tags['azd-env-name'] = 'other'
Reject { Get-CleanupDeployment } 'No exact tagged'
$script:Listing[0].name = 'offline'
Reject { Get-CleanupDeployment } 'No exact tagged'
$script:Listing[0].tags.Remove('azd-env-name')
$selected = Get-CleanupDeployment
Check ($selected.id -ceq $script:Deployment.id) 'Exact legacy native deployment not selected'
$script:Listing[0].properties.provisioningState = 'Running'
Reject { Get-CleanupDeployment } 'No exact tagged'

$script:Action = 'predeploy'
$script:Config['sha'] = 'b' * 40
$script:State['provisioned'] = $true
$script:State.operation = @{ status = 'Accepted'; url = "https://management.azure.com/subscriptions/$($script:Config.subscription)/operation/offline"; deploymentId = 'dep_offline'; sha = ('a' * 40) }
function Get-Config { return $script:Config }
function Assert-Capabilities { }
function Assert-Accounts { }
function Assert-State { }
function Assert-Inventory { }
function Assert-Policy { }
function Invoke-Tool {
    param($Tool, $Arguments)
    if ($Tool -ceq 'builder' -and $Arguments -contains '--help') { return @{ output = 'Usage: builder app version show <name>' } }
    throw 'Unexpected SQL/source/config/admission mutation during recovery'
}
function Invoke-Json {
    param($Tool, $Arguments)
    if ($Arguments -contains 'status') { $script:Polls++; return @{ status = 'Succeeded' } }
    if ($Arguments -contains 'version') { return @{ status = 'ready'; source = @{ provider = 'github'; revision = $script:State.operation.sha } } }
    throw 'Unexpected external command'
}
$script:Verified = 0
function Verify-Health { $script:Verified++ }
Invoke-StageCore
Check ($script:Verified -eq 1) 'Pending operation did not resume before changed input/source checks'
$env:SHOPSTREAM_ENABLE_DEMO_WRITES = 'false'
$env:SHOPSTREAM_PUBLIC_ORIGIN = $null
$script:Config.sha = $script:State.operation.sha
$script:State.operation['fingerprint'] = Digest @($script:Config.sha, (Desired-Variables (Get-App).body), $script:Config.testers)
Invoke-StageCore
Check ($script:Verified -eq 2) 'Same completed source/config did not use observation-only path'
$env:SHOPSTREAM_ENABLE_DEMO_WRITES = 'true'
$env:SHOPSTREAM_PUBLIC_ORIGIN = 'https://offline.app.eastus2.builderapps.dev'
Invoke-StageCore
Check ($script:Verified -eq 3) 'Configuration changes redeployed the same completed SHA'
$script:State.operation['status'] = 'AdmissionUnknown'
$script:State.operation.Remove('url')
Reject { Invoke-StageCore } 'Admission outcome unknown'
Write-Host "PowerShell hook fixtures passed: $script:Checks"
