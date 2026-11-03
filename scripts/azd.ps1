#requires -Version 7.4
[CmdletBinding()]
param(
    [ValidateSet('preprovision', 'postprovision', 'predeploy', 'verify', 'predown', 'postdown', 'native')]
    [string] $Action = 'verify',
    [string] $Environment,
    [string] $Request,
    [switch] $Library
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:Root = Split-Path $PSScriptRoot -Parent
$script:Runner = Join-Path $PSScriptRoot 'azd.ps1'
$script:Api = '2026-09-01-preview'

if ($Action -eq 'native') {
    $call = $Request | ConvertFrom-Json -AsHashtable
    if ($call.tool -notin @('az', 'azd', 'builder', 'gh', 'node')) { throw 'Unsupported native tool' }
    & $call.tool @($call.args)
    exit $LASTEXITCODE
}

function Invoke-Tool {
    param([string] $Tool, [string[]] $Arguments, [hashtable] $ExtraEnv = @{}, [int] $Timeout = 60, [switch] $AllowFailure)
    $info = [Diagnostics.ProcessStartInfo]::new((Get-Command pwsh -CommandType Application | Select-Object -First 1).Source)
    foreach ($arg in @('-NoLogo', '-NoProfile', '-File', $script:Runner, 'native', '-Request',
        (@{ tool = $Tool; args = $Arguments } | ConvertTo-Json -Compress -Depth 20))) {
        $info.ArgumentList.Add($arg)
    }
    $info.WorkingDirectory = $script:Root
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.UseShellExecute = $false
    foreach ($key in $ExtraEnv.Keys) { $info.Environment[$key] = $ExtraEnv[$key] }
    $process = [Diagnostics.Process]::Start($info)
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    try {
        if (-not $process.WaitForExit($Timeout * 1000)) {
            $process.Kill($true)
            $process.WaitForExit()
            throw "$Tool timed out; reconcile any pending operation before retrying"
        }
        $result = @{ code = $process.ExitCode; output = $stdout.GetAwaiter().GetResult(); error = $stderr.GetAwaiter().GetResult() }
        if ($result.code -ne 0 -and -not $AllowFailure) {
            if ($Tool -ceq 'node' -and $Arguments.Count -ge 2 -and $Arguments[0] -ceq 'scripts/azd-verify.cjs') {
                $detail = @($result.error -split "`n" | Where-Object { $_.StartsWith('azd prerequisite verification failed:') })
                if ($detail.Count) { throw $detail[0] }
            }
            throw "$Tool failed (exit $($result.code)); check its selected account/tool compatibility. No automatic retry."
        }
        return $result
    } finally { $process.Dispose() }
}

function Invoke-Json([string] $Tool, [string[]] $Arguments, [int] $Timeout = 60) {
    $result = Invoke-Tool $Tool $Arguments -Timeout $Timeout
    try { return ConvertFrom-Json -InputObject $result.output -AsHashtable -ErrorAction Stop }
    catch { throw "$Tool returned invalid JSON; no operation may be assumed complete" }
}

function Digest($Value) {
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData(
        [Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Depth 30 -Compress)))).ToLowerInvariant()
}

function Save-State {
    $directory = Split-Path $script:StatePath -Parent
    $null = [IO.Directory]::CreateDirectory($directory)
    $temporary = "$script:StatePath.$([Guid]::NewGuid()).tmp"
    [IO.File]::WriteAllText($temporary, ($script:State | ConvertTo-Json -Depth 30))
    [IO.File]::Move($temporary, $script:StatePath, $true)
}

function Set-Output([string] $Name, [string] $Value) {
    $null = Invoke-Tool azd @('env', 'set', $Name, $Value, '-e', $script:Config.env)
    [Environment]::SetEnvironmentVariable($Name, $Value)
}

function Confirm-Action([string] $Message, [string] $Expected) {
    if ([Console]::IsInputRedirected -or $env:CI -or $env:AZD_NON_INTERACTIVE -eq 'true') {
        throw 'This operation requires interactive review; noninteractive approval is not supported'
    }
    Write-Host $Message
    if ((Read-Host "Type $Expected to approve this exact action") -cne $Expected) { throw 'Action not approved' }
}

function Get-Config {
    $selected = if ($Environment) { $Environment } else { $env:AZURE_ENV_NAME }
    if ($selected -cnotmatch '^[a-z][a-z0-9-]{1,18}[a-z0-9]$') { throw 'Select a 3-20 character lowercase azd environment' }
    $values = Invoke-Json azd @('env', 'get-values', '-e', $selected, '--output', 'json')
    $keys = @('AZURE_SUBSCRIPTION_ID', 'AZURE_TENANT_ID', 'AZURE_LOCATION', 'PG_LOCATION', 'PG_SERVER',
        'ADMIN_OBJECT_ID', 'ADMIN_NAME', 'ADMIN_TYPE', 'BOOTSTRAP_IPV4', 'GITHUB_REPOSITORY', 'GITHUB_REF_NAME',
        'GITHUB_SHA', 'GITHUB_ACCOUNT', 'BUILDER_ALLOWED_OBJECT_IDS', 'SHOPSTREAM_ALLOW_AZURE_SERVICES',
        'SHOPSTREAM_ENABLE_DEMO_WRITES', 'SHOPSTREAM_PUBLIC_ORIGIN', 'PGDATABASE', 'PGUSER', 'SAMPLE_INTERNAL_TEST_ALLOW_EASTUS2')
    foreach ($key in $keys) {
        if ($values.ContainsKey($key)) { [Environment]::SetEnvironmentVariable($key, [string]$values[$key]) }
        elseif (Test-Path -LiteralPath "Env:$key") { Remove-Item -LiteralPath "Env:$key" }
    }
    foreach ($key in @('AZURE_LOCATION', 'PG_LOCATION')) {
        if (-not $values.ContainsKey($key)) { [Environment]::SetEnvironmentVariable($key, 'westus2') }
    }
    $env:AZURE_ENV_NAME = $selected
    $null = Invoke-Tool node @('scripts/azd-verify.cjs', 'inputs')
    $suffix = (Digest @($env:AZURE_SUBSCRIPTION_ID.ToLowerInvariant(), $selected)).Substring(0, 8)
    $group = "rg-shopstream-$selected-$suffix"
    if ($values['AZURE_RESOURCE_GROUP'] -and $values['AZURE_RESOURCE_GROUP'] -cne $group) { throw 'Existing/shared group adoption is forbidden' }
    $config = @{
        env = $selected; subscription = $env:AZURE_SUBSCRIPTION_ID; tenant = $env:AZURE_TENANT_ID
        location = $env:AZURE_LOCATION; pgLocation = $env:PG_LOCATION; pg = $env:PG_SERVER
        group = $group; app = "asb-shopstream-$selected-$suffix"
        admin = $env:ADMIN_OBJECT_ID; adminName = $env:ADMIN_NAME
        adminType = $(if ($env:ADMIN_TYPE) { $env:ADMIN_TYPE } else { 'User' })
        ip = $env:BOOTSTRAP_IPV4; allowAzure = $env:SHOPSTREAM_ALLOW_AZURE_SERVICES -ceq 'true'
        testers = @($env:BUILDER_ALLOWED_OBJECT_IDS.ToLowerInvariant().Split(',') | Sort-Object)
        repository = $env:GITHUB_REPOSITORY; branch = $env:GITHUB_REF_NAME; sha = $env:GITHUB_SHA.ToLowerInvariant(); account = $env:GITHUB_ACCOUNT
    }
    $config['base'] = "/subscriptions/$($config.subscription)/resourceGroups/$group"
    $config['appId'] = "$($config.base)/providers/Microsoft.Web/builderApps/$($config.app)"
    $config['pgId'] = "$($config.base)/providers/Microsoft.DBforPostgreSQL/flexibleServers/$($config.pg)"
    $env:AZURE_RESOURCE_GROUP = $group
    $script:StatePath = Join-Path $script:Root ".azure/$selected/shopstream-state.json"
    $script:State = if (Test-Path $script:StatePath) { Get-Content $script:StatePath -Raw | ConvertFrom-Json -AsHashtable } else { $null }
    $script:Config = $config
    return $config
}

function Assert-Accounts {
    $account = Invoke-Json az @('account', 'show', '--subscription', $script:Config.subscription, '-o', 'json')
    if ($account.id -ine $script:Config.subscription -or $account.tenantId -ine $script:Config.tenant) { throw 'Azure subscription/tenant mismatch' }
    $builder = Invoke-Json builder @('account', 'show', '--json')
    if ($builder.tenantId -ine $script:Config.tenant) { throw 'Builder tenant mismatch; sign in explicitly' }
    $null = Invoke-Tool azd @('auth', 'login', '--check-status', '--tenant-id', $script:Config.tenant)
}

function Assert-Capabilities {
    foreach ($contract in @(
        @{ args = @('app', 'deploy', '--help'); flags = @('--commit', '--request-id', '--no-wait', '--json') },
        @{ args = @('app', 'version', 'show', '--help'); flags = @('--json', '--subscription') },
        @{ args = @('app', 'status', '--help'); flags = @('--wait', '--json') },
        @{ args = @('app', 'source', 'connect', 'github', '--help'); flags = @('--repository-id', '--root-directory', '--branch') }
    )) {
        $help = (Invoke-Tool builder $contract.args).output
        foreach ($flag in $contract.flags) { if (-not $help.Contains($flag)) { throw "Required Builder CLI capability $flag missing. Install a compatible published preview archive manually; no upgrade attempted." } }
    }
}

function Get-Target {
    $copy = [ordered]@{}
    foreach ($key in @('env', 'subscription', 'tenant', 'location', 'pgLocation', 'pg', 'group', 'app', 'admin', 'adminName', 'adminType', 'ip', 'allowAzure', 'testers', 'repository', 'branch', 'account')) {
        $copy[$key] = $script:Config[$key]
    }
    return $copy
}

function Assert-State {
    if (-not $script:State -or $script:State['version'] -ne 1 -or $script:State['targetHash'] -cne (Digest (Get-Target))) {
        throw 'Missing ownership receipt or changed target/admin/network/source/policy. Refusing adoption or automatic repair.'
    }
    $owner = [Guid]::Empty
    if (-not [Guid]::TryParse([string]$script:State['owner'], [ref]$owner)) { throw 'Invalid ownership receipt' }
}

function Arm([string] $Method, [string] $Id, $Body = $null, [hashtable] $Headers = @{}, [switch] $Allow404, [string] $Version) {
    $file = Join-Path ([IO.Path]::GetTempPath()) "shopstream-arm-$([Guid]::NewGuid()).json"
    try {
        $apiVersion = if ($Version) { $Version } elseif ($Id -like '*/Microsoft.DBforPostgreSQL/*') { '2026-10-01' } else { $script:Api }
        @{ method = $Method; id = $Id; version = $apiVersion; body = $Body; headers = $Headers } |
            ConvertTo-Json -Depth 30 -Compress | Set-Content $file -Encoding utf8
        $result = Invoke-Json node @('scripts/azd-verify.cjs', 'arm', $file)
        if ($Allow404 -and $result.status -eq 404) { return $null }
        if ($result.status -lt 200 -or $result.status -ge 300) {
            throw "ARM $Method failed (HTTP $($result.status)); stop and inspect the exact target. No automatic retry."
        }
        return $result
    } finally { if (Test-Path $file) { Remove-Item -LiteralPath $file } }
}

function Expected-Resources {
    $c = $script:Config
    return @($c.base, $c.appId, "$($c.appId)/authConfigs/current", $c.pgId, "$($c.pgId)/databases/shopstream",
        "$($c.pgId)/administrators/$($c.admin)", "$($c.pgId)/firewallRules/bootstrap-workstation",
        "$($c.pgId)/firewallRules/devtest-allow-azure-services",
        "$($c.base)/providers/Microsoft.Resources/deployments/shopstream-resources",
        "$($c.base)/providers/Microsoft.Resources/deployments/shopstream-postgresql")
}

function Assert-DeploymentGraph($Deployment, [int] $Depth = 0) {
    if ($Depth -gt 3 -or -not $Deployment.properties.ContainsKey('outputResources')) { throw 'Incomplete deployment resource graph; cleanup is blocked' }
    foreach ($resource in $Deployment.properties.outputResources) {
        if ($resource.id -notin (Expected-Resources)) { throw 'Foreign resource in selected azd deployment graph; cleanup is blocked' }
        if ($resource.id -imatch '/providers/Microsoft.Resources/deployments/') {
            $nested = Arm GET $resource.id -Version '2022-09-01'
            Assert-DeploymentGraph $nested.body ($Depth + 1)
        }
    }
}

function Get-CleanupDeployment {
    $all = @(Invoke-Json az @('deployment', 'sub', 'list', '--subscription', $script:Config.subscription, '-o', 'json'))
    $selected = $null
    foreach ($item in ($all | Sort-Object { $_.properties.timestamp } -Descending)) {
        if ($item.properties.provisioningState -notin @('Succeeded', 'Failed')) { continue }
        $tags = if ($item['tags']) { $item.tags } else { @{} }
        if (($tags['azd-env-name'] -ceq $script:Config.env -and -not $tags.ContainsKey('azd-layer-name')) -or $item.name -ceq $script:Config.env) {
            $selected = $item
            break
        }
    }
    if (-not $selected) { throw 'No exact tagged/legacy azd deployment; ambiguous name-hint cleanup is refused' }
    $deployment = (Arm GET $selected.id -Version '2022-09-01').body
    $parameters = $deployment.properties.parameters
    if ($parameters.ownerId.value -cne $script:State.owner -or $parameters.resourceGroupName.value -cne $script:Config.group -or
        $parameters.environmentName.value -cne $script:Config.env -or -not $deployment.properties.templateHash) { throw 'Selected azd deployment ownership/parameters mismatch' }
    Assert-DeploymentGraph $deployment
    return $deployment
}

function Pg-Collection([string] $Child) {
    $response = Arm GET "$($script:Config.pgId)/$Child"
    if (-not $response.body.ContainsKey('value') -or $response.body.value -isnot [array] -or $response.body['nextLink']) {
        throw 'PostgreSQL child inventory is incomplete; refusing unsafe pagination assumptions'
    }
    return @($response.body.value)
}

function Assert-Inventory {
    Assert-State
    $c = $script:Config
    $group = Invoke-Json az @('group', 'show', '-n', $c.group, '--subscription', $c.subscription, '-o', 'json')
    if ($group.tags['shopstream-owner-id'] -cne $script:State.owner -or $group.tags['azd-env-name'] -cne $c.env) { throw 'Resource group ownership mismatch' }
    $expected = Expected-Resources
    $resources = @(Invoke-Json az @('resource', 'list', '-g', $c.group, '--subscription', $c.subscription, '-o', 'json'))
    foreach ($item in $resources) { if ($item.id -notin $expected) { throw 'Unknown resource in owned group; refusing provision/deployment/deletion' } }
    $server = Arm GET $c.pgId -Allow404
    if (-not $server -and $script:State['provisioned'] -and $Action -ne 'predown') { throw 'Owned PostgreSQL server disappeared; refusing recreation or implicit data reset' }
    if ($server) {
        $auth = $server.body.properties.authConfig
        if ($auth.passwordAuth -cne 'Disabled' -or $auth.activeDirectoryAuth -cne 'Enabled' -or $auth.tenantId -ine $c.tenant) { throw 'PostgreSQL must remain Entra-only in the selected tenant' }
        $rules = @(Pg-Collection firewallRules)
        foreach ($rule in $rules) {
            $ip = switch ($rule.name) {
                'bootstrap-workstation' { $c.ip }
                'devtest-allow-azure-services' { if ($c.allowAzure) { '0.0.0.0' } else { '' } }
                default { throw 'Unknown PostgreSQL firewall rule' }
            }
            if (-not $ip -or $rule.properties.startIpAddress -cne $ip -or $rule.properties.endIpAddress -cne $ip) { throw 'Firewall drift; disabling an IaC condition does not revoke a rule. Review targeted removal.' }
        }
        $names = @($rules | ForEach-Object { $_.name })
        if (($script:State['provisioned'] -or $Action -eq 'postprovision') -and
            (($c.allowAzure -and 'devtest-allow-azure-services' -notin $names) -or
            ($c.ip -and 'bootstrap-workstation' -notin $names))) { throw 'Required approved firewall rule disappeared; review network drift before proceeding' }
        $databases = @(Pg-Collection databases)
        if (@($databases | Where-Object name -NotIn @('shopstream', 'postgres', 'azure_sys', 'azure_maintenance')).Count) { throw 'Unknown database on owned server' }
        $admins = @(Pg-Collection administrators)
        if (@($admins | Where-Object {
            $_['id'] -ine "$($c.pgId)/administrators/$($c.admin)" -or -not $_['properties'] -or
            $_.properties['objectId'] -ine $c.admin -or $_.properties['tenantId'] -ine $c.tenant -or
            $_.properties['principalType'] -ine $c.adminType -or $_.properties['principalName'] -ine $c.adminName
        }).Count -or
            (($script:State['provisioned'] -or $Action -eq 'postprovision') -and $admins.Count -ne 1)) { throw 'Unknown/missing PostgreSQL administrator' }
    }
}

function Get-App {
    $response = Arm GET $script:Config.appId
    $app = $response.body
    if ($app.id -ine $script:Config.appId -or $app.location -ine $script:Config.location -or
        $app.tags['shopstream-owner-id'] -cne $script:State.owner -or
        $app.identity.type -cne 'SystemAssigned' -or -not $app.identity.principalId) { throw 'Builder ownership/location/system identity mismatch' }
    if ($script:State['principal'] -and $script:State.principal -ine $app.identity.principalId) { throw 'Builder principal changed; refusing stale SQL mapping' }
    $script:State['principal'] = $app.identity.principalId
    Save-State
    return $response
}

function Wait-Ready {
    for ($attempt = 0; $attempt -lt 12; $attempt++) {
        $app = Arm GET $script:Config.appId
        $server = Arm GET $script:Config.pgId
        $state = $server.body.properties['state']
        if ($app.body.identity['principalId'] -and $state -ceq 'Ready') { return }
        if ($state -notin @('Ready', 'Creating', 'Updating', 'Starting')) { throw 'Unexpected PostgreSQL readiness state' }
        Start-Sleep -Seconds 5
    }
    throw 'Bounded identity/PostgreSQL readiness wait expired'
}

function Sql-Environment {
    return @{
        ENTRA_CREDENTIAL = 'azure-cli'; PGHOST = "$($script:Config.pg).postgres.database.azure.com"
        PGDATABASE = 'shopstream'; PGUSER = $script:Config.adminName
        RUNTIME_ROLE = 'shopstream_runtime'; RUNTIME_OBJECT_ID = $script:State.principal
        RUNTIME_OBJECT_TYPE = 'service'; AZURE_CLIENT_ID = ''
    }
}

function Assert-Policy {
    $response = Arm GET "$($script:Config.appId)/authConfigs/current"
    $p = $response.body.properties
    if ($p.mode -cne 'required' -or $p.primaryBrowserProvider -cne 'entraId' -or
        $p.entraId.enabled -isnot [bool] -or $p.entraId.enabled -ne $true -or $p.entraId.applicationMode -cne 'managed' -or
        $p.entraId['emails'] -or $p.entraId['emailSuffixes'] -or ($p['github'] -and $p.github['enabled']) -or
        (@($p.entraId.tenantIds) -join ',') -ine $script:Config.tenant -or
        (@($p.entraId.objectIds | Sort-Object) -join ',') -ine ($script:Config.testers -join ',')) { throw 'Required tester-only Entra policy is not confirmed' }
}

function Set-Policy {
    $id = "$($script:Config.appId)/authConfigs/current"
    $current = Arm GET $id
    if ($current.body.properties.mode -cne 'disabled' -or
        -not ($current.body.properties.revision -is [int] -or $current.body.properties.revision -is [long]) -or
        $current.body.properties.revision -ne 0) {
        Assert-Policy
        return
    }
    if (-not $current.etag) { throw 'Authentication ETag unavailable; refusing unguarded policy update' }
    $body = @{ properties = @{ mode = 'required'; primaryBrowserProvider = 'entraId'; entraId = @{
        enabled = $true; applicationMode = 'managed'; tenantIds = @($script:Config.tenant); objectIds = $script:Config.testers
    } } }
    $null = Arm PUT $id $body @{ 'If-Match' = $current.etag }
    Assert-Policy
}

function Assert-Source($App, [string] $RepositoryId) {
    $source = $App.properties.source
    if (-not $source -or $source.provider -ine 'github' -or $source.id -cne $RepositoryId -or
        $source.displayName -ine $script:Config.repository -or $source.reference -cne $script:Config.branch -or
        $source.rootDirectory -notin @('', '.', $null) -or $App.properties.sourceIntegrationState -cne 'Configured') { throw 'Source is not an exact authorized repository/branch/root match' }
    if ($source['autoDeploy'] -eq $true) { throw 'Automatic source deployment must be reviewed and disabled before this controlled workflow' }
}

function Builder-AppArgs([string] $Command) {
    $help = (Invoke-Tool builder @('app', $Command, '--help')).output
    $name = if ($help -match '--name\s') { @('--name', $script:Config.app) } elseif ($help -match '<name>') { @($script:Config.app) } else { throw 'Incompatible Builder CLI app-name contract; no upgrade attempted' }
    return $name + @('--subscription', $script:Config.subscription, '--resource-group', $script:Config.group, '--tenant', $script:Config.tenant)
}

function Assert-OperationUrl([string] $Url) {
    $uri = $null
    if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -cne 'https' -or $uri.Port -ne 443 -or $uri.UserInfo -or
        ($uri.Host -cne 'management.azure.com' -and $uri.Host -cne "$($script:Config.location).management.azure.com") -or
        -not $uri.AbsolutePath.StartsWith("/subscriptions/$($script:Config.subscription)/", [StringComparison]::OrdinalIgnoreCase)) { throw 'Untrusted operation URL in receipt' }
}

function Complete-Operation {
    $op = $script:State['operation']
    if (-not $op -or -not $op['url']) { throw 'Admission outcome unknown: reconcile the saved request ID in Builder before another attempt' }
    Assert-OperationUrl $op.url
    if ($op['status'] -in @('Failed', 'Canceled')) { throw 'Previous rollout failed/canceled; review it before a deliberate new attempt' }
    if ($op['status'] -cne 'Succeeded') {
        $status = Invoke-Json builder @('app', 'status', $op.url, '--subscription', $script:Config.subscription,
            '--tenant', $script:Config.tenant, '--wait', '--json') -Timeout 1200
        if ($status.status -notin @('Succeeded', 'Failed', 'Canceled')) { throw 'Rollout is not terminal; receipt retained for observation only' }
        $op['status'] = $status.status
        Save-State
        Set-Output BUILDER_DEPLOYMENT_STATUS $status.status
        if ($status.status -cne 'Succeeded') { throw 'Builder rollout failed/canceled; no automatic retry' }
    }
    $app = (Get-App).body
    if ($app.properties.runtime.activeDeploymentId -cne $op.deploymentId -or -not $app.properties.runtime.activeAppVersionId) { throw 'Serving deployment differs from accepted operation' }
    $op['version'] = $app.properties.runtime.activeAppVersionId
    $help = (Invoke-Tool builder @('app', 'version', 'show', '--help')).output
    $name = if ($help -match '--name\s') { @('--name', $script:Config.app) } elseif ($help -match '<name>') { @($script:Config.app) } else { throw 'Incompatible version-show CLI contract' }
    $version = Invoke-Json builder (@('app', 'version', 'show') + $name + @($op.version, '--subscription', $script:Config.subscription,
        '--resource-group', $script:Config.group, '--json'))
    if ($version.status -ine 'ready' -or $version.source.provider -ine 'github' -or $version.source.revision -ine $op.sha) { throw 'Active version does not prove the requested GitHub commit' }
    Save-State
    Set-Output BUILDER_APP_DEPLOYMENT_ID $op.deploymentId
    Set-Output BUILDER_APP_VERSION_ID $op.version
    Set-Output BUILDER_DEPLOYMENT_STATUS Succeeded
    Write-Host 'Deployment=Succeeded'
}

function Get-HealthStatus([string] $Url) {
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $handler.UseCookies = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(20)
    $response = $null
    try {
        $response = $client.GetAsync($Url, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        return [int]$response.StatusCode
    } finally {
        if ($response) { $response.Dispose() }
        $client.Dispose()
    }
}

function Verify-Health {
    $app = (Get-App).body
    Assert-Policy
    for ($attempt = 0; $attempt -lt 12; $attempt++) {
        $policy = (Arm GET "$($script:Config.appId)/authConfigs/current").body.properties
        if ($policy.ContainsKey('revision') -and $policy.ContainsKey('appliedRevision') -and
            $policy.appliedRevision -eq $policy.revision -and $policy['propagationPending'] -eq $false) { break }
        if ($attempt -eq 11) { throw 'Authentication propagation is not confirmed; observe the saved rollout without redeployment' }
        Start-Sleep -Seconds 5
    }
    Set-Output BUILDER_AUTH_STATUS Applied
    $url = $app.properties['publicUrl']
    if (-not $url -and $app.properties['runtime']) { $url = $app.properties.runtime['url'] }
    $uri = $null
    if (-not [Uri]::TryCreate($url, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -cne 'https' -or
        $uri.UserInfo -or $uri.Port -ne 443 -or $uri.Query -or $uri.Fragment -or
        $uri.Host -notlike '*.builderapps.dev' -or $uri.AbsolutePath -cne '/') { throw 'Builder returned no trusted HTTPS runtime URL' }
    Set-Output BUILDER_APP_URL $uri.GetLeftPart([UriPartial]::Authority)
    $status = Get-HealthStatus "$($uri.GetLeftPart([UriPartial]::Authority))/health"
    if ($status -in @(401, 403, 302)) {
        Set-Output SHOPSTREAM_VERIFICATION_STATUS AwaitingInteractiveVerification
        Set-Output BUILDER_HEALTH_STATUS AwaitingInteractiveVerification
        Set-Output SHOPSTREAM_CRUD_STATUS NotRun
        $script:State['verification'] = 'AwaitingInteractiveVerification'
        Save-State
        Write-Host 'Health=AwaitingInteractiveVerification CRUD=NotRun'
        $incomplete = [InvalidOperationException]::new('Rollout completed; open BUILDER_APP_URL, use tester SSO/consent, and verify SQL health/read/CRUD separately. Do not redeploy to finish browser verification.')
        $incomplete.Data['ExitCode'] = 3
        throw $incomplete
    }
    throw "Tester-protected health returned unexpected HTTP $status; do not weaken the policy"
}

function Desired-Variables($App) {
    $c = $script:Config
    $variables = [ordered]@{ PGHOST = "$($c.pg).postgres.database.azure.com"; PGDATABASE = 'shopstream'; PGUSER = 'shopstream_runtime';
        ENTRA_CREDENTIAL = 'managed-identity'; SHOPSTREAM_ENABLE_DEMO_WRITES = $(if ($env:SHOPSTREAM_ENABLE_DEMO_WRITES -ceq 'true') { 'true' } else { 'false' }) }
    if ($env:SHOPSTREAM_PUBLIC_ORIGIN) {
        $actual = $App.properties['publicUrl']
        if (-not $actual -and $App.properties['runtime']) { $actual = $App.properties.runtime['url'] }
        if (-not $actual -or $env:SHOPSTREAM_PUBLIC_ORIGIN -cne ([Uri]$actual).GetLeftPart([UriPartial]::Authority)) { throw 'Configured public origin does not equal actual Builder HTTPS origin' }
        $variables['SHOPSTREAM_PUBLIC_ORIGIN'] = $env:SHOPSTREAM_PUBLIC_ORIGIN
    }
    return $variables
}

function Invoke-StageCore {
    $c = Get-Config
    Assert-Capabilities
    Assert-Accounts
    if ($Action -eq 'preprovision') {
        if (-not $c.allowAzure) { throw 'No supported Builder route selected. Explicit DEV/TEST Azure-services approval is required for this fast path.' }
        $exists = Invoke-Json az @('group', 'exists', '-n', $c.group, '--subscription', $c.subscription)
        if ($exists) { Assert-Inventory } elseif ($script:State -and $script:State['provisioned']) { throw 'Owned environment disappeared; refuse automatic recreation' }
        Confirm-Action "Create/update ONLY $($c.group) in subscription $($c.subscription). PG admin is setup-only. Azure-services rule admits Azure sources across subscriptions/tenants. Billable PG16/B1ms/32GiB; review location/cost/permissions first." $c.env
        if (-not $script:State) {
            $script:State = @{ version = 1; owner = [Guid]::NewGuid().ToString(); targetHash = Digest (Get-Target) }
            Save-State
        }
        Assert-State
        Set-Output AZURE_RESOURCE_GROUP $c.group
        Set-Output SHOPSTREAM_OWNER_ID $script:State.owner
        Set-Output BUILDER_APP_NAME $c.app
        $present = if ($exists) { Arm GET $c.appId -Allow404 } else { $null }
        if (-not $present -and ($script:State['provisioned'] -or $script:State['principal'])) { throw 'Owned Builder app disappeared; refusing automatic recreation or identity replacement' }
        if ($present) { $null = Get-App }
        Set-Output SHOPSTREAM_CREATE_APP $(if ($present) { 'false' } else { 'true' })
        return
    }
    Assert-State
    if ($Action -eq 'postdown') {
        $exists = Invoke-Json az @('group', 'exists', '-n', $c.group, '--subscription', $c.subscription)
        if ($exists) { throw 'Owned group deletion is incomplete; receipt retained' }
        if ((Arm GET $c.appId -Allow404) -or (Arm GET $c.pgId -Allow404)) { throw 'App/server deletion is not confirmed' }
        $script:State['deleted'] = $true
        Save-State
        Write-Host 'Cleanup=Verified (owned group/app/PG including database roles and data)'
        return
    }
    Assert-Inventory
    if ($Action -eq 'predown') {
        if ($script:State['operation'] -and $script:State.operation['status'] -notin @('Succeeded', 'Failed', 'Canceled')) { throw 'Unresolved rollout outcome; reconcile it before cleanup' }
        $deployment = Get-CleanupDeployment
        if ($deployment.id -ine $script:State['deploymentId'] -or $deployment.properties.templateHash -cne $script:State['templateHash']) { throw 'Latest azd deployment changed; cleanup is blocked' }
        Confirm-Action "DELETE $($c.group), $($c.app), $($c.pg), all contained SQL roles/DATA and firewall rules. No fork/GitHub installation/account deletion. Unknown resources already rejected." "delete-$($c.env)"
        Write-Host 'Cleanup=ApprovedForOwnedEnvironmentOnly'
        return
    }
    if ($Action -eq 'postprovision') { Wait-Ready }
    $app = (Get-App).body
    if ($Action -eq 'postprovision') {
        $deployment = Get-CleanupDeployment
        $script:State['deploymentId'] = $deployment.id
        $script:State['templateHash'] = $deployment.properties.templateHash
        Save-State
        if (-not $script:State['policyConfigured']) {
            Set-Policy
            $script:State['policyConfigured'] = $true
            Save-State
        }
        Assert-Policy
        Set-Output SHOPSTREAM_DATABASE_SETUP_STATUS Pending
        foreach ($command in @('bootstrap', 'grant')) {
            $null = Invoke-Tool node @('db/setup.js', $command) (Sql-Environment) -Timeout 180
        }
        $null = Invoke-Tool node @('scripts/azd-verify.cjs', 'sql') (Sql-Environment) -Timeout 120
        $script:State['provisioned'] = $true
        Save-State
        Set-Output BUILDER_APP_PRINCIPAL_ID $script:State.principal
        Set-Output SHOPSTREAM_DATABASE_SETUP_STATUS Verified
        Write-Host 'Infrastructure=Succeeded DatabaseSetup=Verified'
        return
    }
    if (-not $script:State['provisioned']) { throw 'Successful provision/bootstrap receipt required before deployment' }
    Assert-Policy
    if ($Action -eq 'verify') {
        Complete-Operation
        Verify-Health
        return
    }
    if ($script:State['operation'] -and $script:State.operation['status'] -cne 'Succeeded') {
        Complete-Operation
        Verify-Health
        return
    }
    if ($script:State['operation'] -and $script:State.operation.sha -ieq $c.sha) {
        Write-Host 'Configuration=ObserveOnly (same completed GITHUB_SHA; new configuration requires a different reviewed pushed commit)'
        Complete-Operation
        Verify-Health
        return
    }
    $variables = Desired-Variables $app
    $fingerprint = Digest @($c.sha, $variables, $c.testers)
    $null = Invoke-Tool node @('scripts/azd-verify.cjs', 'sql') (Sql-Environment) -Timeout 120
    $user = Invoke-Json gh @('api', '--hostname', 'github.com', 'user')
    if ($user.login -ine $c.account) { throw 'Active GitHub account mismatch; select it explicitly before authorizing source' }
    $repo = Invoke-Json gh @('api', '--hostname', 'github.com', "repos/$($c.repository)")
    if ($repo.full_name -ine $c.repository -or -not $repo.id) { throw 'GitHub repository ID/name mismatch' }
    $branch = [Uri]::EscapeDataString($c.branch)
    $commit = Invoke-Json gh @('api', '--hostname', 'github.com', "repos/$($c.repository)/commits/$branch")
    if ($commit.sha -ine $c.sha) { throw 'Reviewed GITHUB_SHA is not the selected branch head; review and update before deployment' }
    $deployHelp = (Invoke-Tool builder @('app', 'deploy', '--help')).output
    if ($deployHelp -notmatch '--commit' -or $deployHelp -notmatch '--request-id' -or $deployHelp -notmatch '--no-wait') { throw 'Compatible Builder GitHub commit/admission contract missing; no installation attempted' }
    if ($app.properties['source']) {
        Assert-Source $app ([string]$repo.id)
    } else {
        if ($script:State['sourcePending']) { throw 'Source authorization outcome uncertain; reconcile native source state before retrying' }
        Confirm-Action "Authorize GitHub account $($c.account) to transfer repository access to Builder for $($c.repository) id $($repo.id), branch $($c.branch), root '.', app $($c.app). Human login/consent may be required." "authorize-$($c.env)"
        $script:State['sourcePending'] = $true
        Save-State
        Set-Output BUILDER_SOURCE_STATUS Pending
        $null = Invoke-Tool builder @('source', 'login', 'github', '--account', $c.account) -Timeout 180
        $sourceHelp = (Invoke-Tool builder @('app', 'source', 'connect', 'github', '--help')).output
        $sourceName = if ($sourceHelp -match '--name\s') { @('--name', $c.app) } elseif ($sourceHelp -match '<name>') { @($c.app) } else { throw 'Incompatible source-connect CLI contract' }
        $null = Invoke-Tool builder (@('app', 'source', 'connect', 'github') + $sourceName + @('--subscription', $c.subscription,
            '--resource-group', $c.group, '--tenant', $c.tenant, '--repository', $c.repository,
            '--repository-id', [string]$repo.id, '--branch', $c.branch, '--root-directory', '.', '--json')) -Timeout 180
        $app = (Get-App).body
        Assert-Source $app ([string]$repo.id)
    }
    $script:State['sourcePending'] = $false
    Save-State
    Set-Output BUILDER_SOURCE_STATUS Configured
    Confirm-Action "Deploy reviewed GitHub commit $($c.sha) to ONLY $($c.app), preserve tester policy/TLS/nonadmin identity; demo writes=$($variables.SHOPSTREAM_ENABLE_DEMO_WRITES)." "deploy-$($c.env)"
    Set-Output BUILDER_DEPLOYMENT_STATUS Pending
    Set-Output BUILDER_AUTH_STATUS Pending
    Set-Output BUILDER_HEALTH_STATUS NotRun
    Set-Output SHOPSTREAM_VERIFICATION_STATUS NotRun
    Set-Output SHOPSTREAM_CRUD_STATUS NotRun
    $merged = @()
    $known = @('PGHOST', 'PGDATABASE', 'PGUSER', 'ENTRA_CREDENTIAL', 'SHOPSTREAM_ENABLE_DEMO_WRITES', 'SHOPSTREAM_PUBLIC_ORIGIN')
    $existingVariables = if ($app.properties['versionConfiguration'] -and $app.properties.versionConfiguration['variables']) { @($app.properties.versionConfiguration['variables']) } else { @() }
    foreach ($entry in $existingVariables) {
        if ($entry.name -notin $known) {
            if ($entry.name -in @('DATABASE_URL', 'PGPASSWORD', 'PGSSLMODE', 'AZURE_CLIENT_ID', 'NODE_TLS_REJECT_UNAUTHORIZED')) { throw 'Conflicting runtime credential/TLS variable; review separately' }
            $merged += @{ name = $entry.name }
        }
    }
    foreach ($key in $variables.Keys) { $merged += @{ name = $key; value = $variables[$key] } }
    $null = Arm PATCH $c.appId @{ properties = @{ versionConfiguration = @{ variables = $merged } } }
    Assert-Policy
    $script:State['operation'] = @{ requestId = [Guid]::NewGuid().ToString(); fingerprint = $fingerprint; status = 'AdmissionUnknown'; sha = $c.sha }
    Save-State
    Set-Output BUILDER_DEPLOYMENT_STATUS AdmissionUnknown
    $args = @('app', 'deploy') + (Builder-AppArgs deploy) + @('--commit', $c.sha, '--request-id', $script:State.operation.requestId, '--no-wait', '--json')
    $accepted = Invoke-Json builder $args
    if (-not $accepted.operationUrl -or -not $accepted.deploymentId) { throw 'Deployment response lacks operation/deployment coordinates; reconcile saved request before retrying' }
    Assert-OperationUrl $accepted.operationUrl
    $script:State.operation['url'] = $accepted.operationUrl
    $script:State.operation['deploymentId'] = $accepted.deploymentId
    $script:State.operation['status'] = 'Accepted'
    Save-State
    Set-Output BUILDER_DEPLOYMENT_STATUS Accepted
    Write-Host "Deployment=Accepted RequestId=$($script:State.operation.requestId) DeploymentId=$($accepted.deploymentId)"
    Complete-Operation
    Verify-Health
}

function Invoke-Stage {
    $selected = if ($Environment) { $Environment } else { $env:AZURE_ENV_NAME }
    if ($selected -cnotmatch '^[a-z][a-z0-9-]{1,18}[a-z0-9]$') { throw 'Select an explicit valid azd environment' }
    $directory = Join-Path $script:Root ".azure/$selected"
    $null = [IO.Directory]::CreateDirectory($directory)
    $lock = [IO.File]::Open((Join-Path $directory 'shopstream.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    try { Invoke-StageCore } finally { $lock.Dispose() }
}

if (-not $Library) {
    try { Invoke-Stage }
    catch {
        Write-Error "ShopStream azd $Action stopped: $($_.Exception.Message)" -ErrorAction Continue
        if ($_.Exception.Data['ExitCode'] -eq 3) { exit 3 }
        exit 1
    }
}
