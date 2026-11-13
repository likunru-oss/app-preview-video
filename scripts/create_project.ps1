# Create a new preview-video project from the template and install dependencies. (Windows)
# Messages are in English on purpose: Windows PowerShell 5.1 misreads non-ASCII script text.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File create_project.ps1 -Target <folder> [-InstallNode]
#
# Needs Node.js 18+. When none is found:
#   without -InstallNode: does nothing, exits with code 3 and says what would be downloaded.
#   with    -InstallNode: downloads the official portable zip from nodejs.org (~30 MB), verifies
#                         its SHA-256, and unpacks it under %LOCALAPPDATA%\app-preview-video.
#                         Nothing is installed system-wide and no admin rights are needed.
# So: run without the switch first -> exit code 3 -> ask the user -> rerun with -InstallNode.
param(
  [Parameter(Mandatory = $true)][string]$Target,
  [switch]$InstallNode
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$NodeVersion = 'v22.11.0'
# From the official SHASUMS256.txt, pinned here: a download that does not match is rejected.
$Hashes = @{
  'win-x64'   = '905373a059aecaf7f48c1ce10ffbd5334457ca00f678747f19db5ea7d256c236'
  'win-arm64' = 'b9ff5a6b6ffb68a0ffec82cc5664ed48247dabbd25ee6d129facd2f65a8ca80d'
}

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Template = Join-Path (Split-Path -Parent $Here) 'assets\template'
if (Test-Path $Target) { Write-Host "Target already exists: $Target (pick another folder so nothing is overwritten)"; exit 1 }

$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$Plat = "win-$Arch"
$ApvHome = if ($env:APV_HOME) { $env:APV_HOME } else { Join-Path $env:LOCALAPPDATA 'app-preview-video' }
$Name = "node-$NodeVersion-$Plat"
$PrivateNode = Join-Path $ApvHome $Name

# 1) Find Node: system one (18+) first, then a portable copy downloaded earlier.
$NodeDir = $null
$sys = Get-Command node -ErrorAction SilentlyContinue
$sysOk = $false
if ($sys -and $env:APV_IGNORE_SYSTEM_NODE -ne '1') {
  $major = [int](& node -p 'parseInt(process.versions.node)')
  if ($major -ge 18) { $sysOk = $true }
}
if ($sysOk) {
  Write-Host "Using system Node.js $(& node -v)"
} elseif (Test-Path (Join-Path $PrivateNode 'node.exe')) {
  $NodeDir = $PrivateNode
  Write-Host "Using the portable Node.js $NodeVersion downloaded earlier"
} else {
  $Url = "https://nodejs.org/dist/$NodeVersion/$Name.zip"
  if (-not $InstallNode) {
    Write-Host 'NEED_NODE'
    Write-Host 'No usable Node.js (18+) was found on this computer.'
    Write-Host "It can be downloaded automatically: $Url (about 30 MB),"
    Write-Host "unpacked into $ApvHome and used only by this skill. No system changes, no admin rights."
    Write-Host 'Ask the user for permission first, then rerun with -InstallNode.'
    exit 3
  }
  New-Item -ItemType Directory -Force -Path $ApvHome | Out-Null
  $Zip = Join-Path $ApvHome "$Name.zip"
  Write-Host "Downloading $Name.zip from nodejs.org ..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing
  $Got = (Get-FileHash -Path $Zip -Algorithm SHA256).Hash.ToLower()
  if ($Got -ne $Hashes[$Plat]) {
    Remove-Item -Force $Zip
    Write-Host 'Checksum mismatch: the download does not match the official SHA-256. It was deleted and not used.'
    Write-Host 'This can be a network problem or a blocked download. Retry, or install Node.js manually.'
    exit 1
  }
  Expand-Archive -Path $Zip -DestinationPath $ApvHome -Force
  Remove-Item -Force $Zip
  $NodeDir = $PrivateNode
  Write-Host "Checksum OK. Unpacked to $PrivateNode"
}
if ($NodeDir) { $env:PATH = "$NodeDir;$env:PATH" }

# 2) Copy the template and install dependencies.
$parent = Split-Path -Parent $Target
if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
Copy-Item -Recurse -Path $Template -Destination $Target
Push-Location $Target
try {
  # When the portable copy is used, remember where it is; run.cmd picks it up.
  if ($NodeDir) { [IO.File]::WriteAllText((Join-Path (Get-Location) '.node-dir'), $NodeDir) }
  & npm.cmd install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
  Write-Host ''
  Write-Host "Project created: $(Get-Location)"
  Write-Host 'Start the control panel:  run.cmd npm run panel   (default http://127.0.0.1:5173)'
  Write-Host 'Run every other command through run.cmd too, e.g.  run.cmd npx remotion still src/index.ts AppPreview f.jpg --frame=60'
} finally {
  Pop-Location
}
