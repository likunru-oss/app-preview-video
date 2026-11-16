# Create a new preview-video project from the template and install dependencies. (Windows)
# Messages are in English on purpose: Windows PowerShell 5.1 misreads non-ASCII script text.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File create_project.ps1 -Target <folder> [-InstallNode] [-InstallFfmpeg]
#
# Needs Node.js 22+ and FFmpeg (for exporting video). For each one that is missing:
#   without its switch: does nothing, exits with code 3, prints NEED_NODE / NEED_FFMPEG and what would be downloaded.
#   with its switch   : downloads the official portable build, verifies its pinned SHA-256, and unpacks it
#                       under %LOCALAPPDATA%\app-preview-video. Nothing is installed system-wide, no admin rights.
# So: run without switches first -> exit code 3 -> ask the user -> rerun with the switches.
param(
  [Parameter(Mandatory = $true)][string]$Target,
  [switch]$InstallNode,
  [switch]$InstallFfmpeg
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$NodeVersion = 'v22.11.0'
# From the official SHASUMS256.txt, pinned here: a download that does not match is rejected.
$NodeHashes = @{
  'win-x64'   = '905373a059aecaf7f48c1ce10ffbd5334457ca00f678747f19db5ea7d256c236'
  'win-arm64' = 'b9ff5a6b6ffb68a0ffec82cc5664ed48247dabbd25ee6d129facd2f65a8ca80d'
}
# FFmpeg 6.0 static build from github.com/eugeneware/ffmpeg-static release b6.1.1 (x64; also runs on Windows on ARM).
# SHA-256 values as published by GitHub for those release files.
$FfmpegTag = 'b6.1.1'
$FfmpegHashes = @{
  'ffmpeg'  = '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77'
  'ffprobe' = 'f309e6223ad89d2fe54bccd420a7709b66fd27540674e92309578ed491a43c8d'
}

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Template = Join-Path (Split-Path -Parent $Here) 'assets\template'
if (Test-Path $Target) { Write-Host "Target already exists: $Target (pick another folder so nothing is overwritten)"; exit 1 }

$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$Plat = "win-$Arch"
$ApvHome = if ($env:APV_HOME) { $env:APV_HOME } else { Join-Path $env:LOCALAPPDATA 'app-preview-video' }
$NodeName = "node-$NodeVersion-$Plat"
$PrivateNode = Join-Path $ApvHome $NodeName
$PrivateFfmpeg = Join-Path $ApvHome "ffmpeg-$FfmpegTag-win32-x64"

# 1) What is missing?
$NodeDir = $null; $NeedNode = $false
$sys = Get-Command node -ErrorAction SilentlyContinue
$sysOk = $false
if ($sys -and $env:APV_IGNORE_SYSTEM_NODE -ne '1') {
  $major = [int](& node -p 'parseInt(process.versions.node)')
  if ($major -ge 22) { $sysOk = $true }
}
if ($sysOk) { Write-Host "Using system Node.js $(& node -v)" }
elseif (Test-Path (Join-Path $PrivateNode 'node.exe')) { $NodeDir = $PrivateNode; Write-Host "Using the portable Node.js $NodeVersion downloaded earlier" }
else { $NeedNode = $true }

$FfmpegDir = $null; $NeedFfmpeg = $false
if ((Get-Command ffmpeg -ErrorAction SilentlyContinue) -and (Get-Command ffprobe -ErrorAction SilentlyContinue) -and $env:APV_IGNORE_SYSTEM_FFMPEG -ne '1') { Write-Host 'Using system FFmpeg' }
elseif ((Test-Path (Join-Path $PrivateFfmpeg 'ffmpeg.exe')) -and (Test-Path (Join-Path $PrivateFfmpeg 'ffprobe.exe'))) { $FfmpegDir = $PrivateFfmpeg; Write-Host 'Using the portable FFmpeg downloaded earlier' }
else { $NeedFfmpeg = $true }

$Ask = $false
if ($NeedNode -and -not $InstallNode) {
  Write-Host 'NEED_NODE'
  Write-Host 'No usable Node.js (22+) was found. It can be downloaded automatically:'
  Write-Host "  https://nodejs.org/dist/$NodeVersion/$NodeName.zip (about 30 MB)"
  $Ask = $true
}
if ($NeedFfmpeg -and -not $InstallFfmpeg) {
  Write-Host 'NEED_FFMPEG'
  Write-Host 'FFmpeg (needed to export video) was not found. A static build (FFmpeg 6.0) can be downloaded automatically:'
  Write-Host "  ffmpeg-win32-x64.gz and ffprobe-win32-x64.gz from https://github.com/eugeneware/ffmpeg-static/releases/tag/$FfmpegTag (about 30 MB each)"
  $Ask = $true
}
if ($Ask) {
  Write-Host "Downloads are verified against pinned SHA-256 values, unpacked into $ApvHome and used only by this skill. No system changes, no admin rights."
  Write-Host 'Ask the user for permission first, then rerun with -InstallNode / -InstallFfmpeg.'
  exit 3
}

# 2) Download what is missing.
New-Item -ItemType Directory -Force -Path $ApvHome | Out-Null
if ($NeedNode) {
  $Zip = Join-Path $ApvHome "$NodeName.zip"
  Write-Host "Downloading $NodeName.zip from nodejs.org ..."
  Invoke-WebRequest -Uri "https://nodejs.org/dist/$NodeVersion/$NodeName.zip" -OutFile $Zip -UseBasicParsing
  if ((Get-FileHash -Path $Zip -Algorithm SHA256).Hash.ToLower() -ne $NodeHashes[$Plat]) {
    Remove-Item -Force $Zip
    Write-Host 'Node.js checksum mismatch: the download was deleted and not used. Retry, or install Node.js manually.'
    exit 1
  }
  Expand-Archive -Path $Zip -DestinationPath $ApvHome -Force
  Remove-Item -Force $Zip
  $NodeDir = $PrivateNode
  Write-Host 'Node.js checksum OK'
}
if ($NeedFfmpeg) {
  New-Item -ItemType Directory -Force -Path $PrivateFfmpeg | Out-Null
  foreach ($b in @('ffmpeg', 'ffprobe')) {
    $Gz = Join-Path $PrivateFfmpeg "$b.gz"
    Write-Host "Downloading $b-win32-x64.gz from GitHub ..."
    Invoke-WebRequest -Uri "https://github.com/eugeneware/ffmpeg-static/releases/download/$FfmpegTag/$b-win32-x64.gz" -OutFile $Gz -UseBasicParsing
    if ((Get-FileHash -Path $Gz -Algorithm SHA256).Hash.ToLower() -ne $FfmpegHashes[$b]) {
      Remove-Item -Force $Gz
      Write-Host 'FFmpeg checksum mismatch: the download was deleted and not used. Retry, or install FFmpeg manually.'
      exit 1
    }
    $in = [IO.File]::OpenRead($Gz)
    $out = [IO.File]::Create((Join-Path $PrivateFfmpeg "$b.exe"))
    try { $gz = New-Object IO.Compression.GZipStream($in, [IO.Compression.CompressionMode]::Decompress); $gz.CopyTo($out); $gz.Dispose() } finally { $out.Dispose(); $in.Dispose() }
    Remove-Item -Force $Gz
  }
  $FfmpegDir = $PrivateFfmpeg
  Write-Host 'FFmpeg checksum OK'
}
if ($NodeDir) { $env:PATH = "$NodeDir;$env:PATH" }

# 3) Copy the template and install dependencies.
$parent = Split-Path -Parent $Target
if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
Copy-Item -Recurse -Path $Template -Destination $Target
Push-Location $Target
try {
  # When portable copies are used, remember where they are: run.cmd adds Node, the export script finds FFmpeg.
  if ($NodeDir) { [IO.File]::WriteAllText((Join-Path (Get-Location) '.node-dir'), $NodeDir) }
  if ($FfmpegDir) { [IO.File]::WriteAllText((Join-Path (Get-Location) '.ffmpeg-dir'), $FfmpegDir) }
  & npm.cmd install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
  Write-Host ''
  Write-Host "Project created: $(Get-Location)"
  Write-Host 'Start the control panel:  run.cmd npm run panel   (default http://127.0.0.1:5173)'
  Write-Host 'Export the video:         run.cmd npm run render  (writes out\app-preview.mp4)'
} finally {
  Pop-Location
}
