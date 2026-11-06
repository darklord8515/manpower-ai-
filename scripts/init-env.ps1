# Creates the repo-root .env from env.example with freshly generated random secrets.
# Safe to re-run: it never overwrites an existing value. If .env already exists it only adds
# generated secrets for keys that are missing or empty (for example DEMO_PASSWORD, added later).
# Values are never printed.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root '.env'
$template = Join-Path $root 'env.example'

$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$alphabet = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
function New-Secret([int]$Length) {
    $bytes = New-Object byte[] $Length
    $rng.GetBytes($bytes)
    -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
}

if (Test-Path $target) {
    $text = [System.IO.File]::ReadAllText($target)
    $added = @()
    foreach ($key in @('DEMO_PASSWORD')) {
        if ($text -notmatch "(?m)^$key=\S") {
            if ($text -match "(?m)^$key=\s*$") {
                $text = [regex]::Replace($text, "(?m)^$key=\s*$", "$key=$(New-Secret 20)")
            } else {
                $text = $text.TrimEnd() + "`r`n$key=$(New-Secret 20)`r`n"
            }
            $added += $key
        }
    }
    if ($added.Count -eq 0) {
        Write-Host ".env already exists and is complete; leaving it untouched."
    } else {
        [System.IO.File]::WriteAllText($target, $text, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host ".env updated: generated a value for $($added -join ', ') (not shown)."
    }
    exit 0
}

$appPassword = New-Secret 28
$values = @{
    POSTGRES_PASSWORD  = New-Secret 28
    APP_DB_PASSWORD    = $appPassword
    N8N_DB_PASSWORD    = New-Secret 28
    N8N_ENCRYPTION_KEY = New-Secret 40
    N8N_HMAC_SECRET    = New-Secret 40
    SECRET_KEY         = New-Secret 48
    DEMO_PASSWORD      = New-Secret 20
}

$text = Get-Content $template -Raw
foreach ($key in $values.Keys) {
    $text = [regex]::Replace($text, "(?m)^$key=\s*$", "$key=$($values[$key])")
}
$text = $text.Replace('constructiq_app:CHANGE-ME@', "constructiq_app:$appPassword@")

[System.IO.File]::WriteAllText($target, $text, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ".env created with generated secrets (not shown). Edit it for providers and hosting later."
