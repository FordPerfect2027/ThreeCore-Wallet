$ErrorActionPreference = 'Stop'
$packagePath = 'C:/Users/aseet/Downloads/ThreeCore-complete-288efc3-20261103-r1'
$zipPath = 'C:/Users/aseet/Downloads/ThreeCore-complete-288efc3-20261103-r1.zip'
$extractPath = 'C:/Users/aseet/Downloads/ThreeCore-complete-288efc3-extracted-20261103-r1'
if (!(Test-Path -LiteralPath $packagePath -PathType Container)) { throw 'Package is missing' }
foreach ($newPath in @($zipPath, $extractPath)) {
  if (Test-Path -LiteralPath $newPath) { throw "Destination already exists: $newPath" }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($packagePath, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
[System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extractPath)
$identity = [ordered]@{
  recordedAt = [DateTime]::UtcNow.ToString('o')
  package = $packagePath
  zip = $zipPath
  extracted = $extractPath
  bytes = (Get-Item -LiteralPath $zipPath).Length
  sha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  sourceRevision = '288efc3'
  previousPackagesOverwritten = $false
}
$identity | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'zip-identity.json') -Encoding utf8
$identity | ConvertTo-Json -Compress
