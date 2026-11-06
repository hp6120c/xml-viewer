param(
  [Parameter(Mandatory = $true)]
  [string]$Tag,
  [string]$Owner = "hp6120c",
  [string]$Repo = "xml-viewer"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($env:GITEE_ACCESS_TOKEN)) {
  throw "GITEE_ACCESS_TOKEN is required to sync release assets to Gitee"
}
if ([string]::IsNullOrWhiteSpace($env:GITHUB_TOKEN)) {
  throw "GITHUB_TOKEN is required to update the GitHub updates branch"
}

$tag = $Tag.Trim()
$owner = $Owner.Trim()
$giteeRepo = $Repo.Trim()
$token = $env:GITEE_ACCESS_TOKEN.Trim()
$githubRepo = $env:GITHUB_REPOSITORY
$downloadDir = Join-Path $env:RUNNER_TEMP "gitee-release-$tag"
New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null

gh release download $tag --repo $githubRepo --pattern "*.exe" --pattern "*.exe.sig" --pattern "latest.json" --dir $downloadDir --clobber
if ($LASTEXITCODE -ne 0) {
  throw "Unable to download GitHub release assets for Gitee sync"
}

$setupAsset = Get-ChildItem $downloadDir -Filter "*.exe" | Select-Object -First 1
if (-not $setupAsset) {
  throw "The GitHub release download does not contain an NSIS setup executable"
}
$signatureAsset = Get-Item "$($setupAsset.FullName).sig" -ErrorAction Stop
$githubLatestPath = Join-Path $downloadDir "latest.json"
if (-not (Test-Path $githubLatestPath)) {
  throw "The GitHub release download does not contain latest.json"
}

$repoApi = "https://gitee.com/api/v5/repos/$owner/$giteeRepo"
$repoReady = $false
for ($attempt = 1; $attempt -le 12; $attempt += 1) {
  try {
    Invoke-RestMethod -Method Get -Uri $repoApi -TimeoutSec 20 | Out-Null
    $repoReady = $true
    break
  } catch {
    Start-Sleep -Seconds 10
  }
}
if (-not $repoReady) {
  throw "Gitee repository $owner/$giteeRepo is not reachable. Create the mirror repository first."
}

$releaseUri = "$repoApi/releases/tags/$tag`?access_token=$token"
$release = $null
try {
  $release = Invoke-RestMethod -Method Get -Uri $releaseUri -TimeoutSec 30
} catch {
  Write-Host "Gitee release does not exist yet; creating $tag."
  $createUri = "$repoApi/releases?access_token=$token"
  $createBody = @{
    tag_name = $tag
    name = "XML / Markdown / CSV 编辑器 $tag"
    body = "Gitee mirror release for $tag. Installer and updater signature are mirrored from the GitHub release."
    prerelease = "false"
    target_commitish = "master"
  }
  $createStatus = 0
  $createResponse = Invoke-WebRequest -Method Post -Uri $createUri -Body $createBody -ContentType "application/x-www-form-urlencoded" -SkipHttpErrorCheck -StatusCodeVariable createStatus -TimeoutSec 30
  if ($createStatus -lt 200 -or $createStatus -ge 300) {
    throw "Gitee release creation failed with HTTP ${createStatus}: $($createResponse.Content)"
  }
  $responseText = [string]$createResponse.Content
  if (-not [string]::IsNullOrWhiteSpace($responseText)) {
    try { $release = $responseText | ConvertFrom-Json } catch { $release = $null }
  }
}

if (-not $release -or -not $release.id) {
  for ($attempt = 1; $attempt -le 5; $attempt += 1) {
    Start-Sleep -Seconds 2
    try {
      $release = Invoke-RestMethod -Method Get -Uri $releaseUri -TimeoutSec 30
      if ($release -and $release.id) { break }
    } catch {
      $release = $null
    }
  }
}
if (-not $release -or -not $release.id) {
  throw "Unable to resolve the Gitee release ID for $tag after creation"
}

$attachmentsUri = "$repoApi/releases/$($release.id)/attach_files"
$existingAttachments = @(Invoke-RestMethod -Method Get -Uri "$attachmentsUri`?access_token=$token&per_page=100" -TimeoutSec 30)
$giteeAssets = @{}

foreach ($asset in @($setupAsset, $signatureAsset)) {
  $existing = $existingAttachments | Where-Object { $_.name -eq $asset.Name } | Select-Object -First 1
  if ($existing) {
    $giteeAssets[$asset.Name] = $existing
    Write-Host "Gitee attachment already exists: $($asset.Name)"
    continue
  }

  $uploadResponse = curl.exe -sS --fail-with-body -X POST $attachmentsUri `
    -F "access_token=$token" `
    -F "file=@$($asset.FullName)"
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to upload $($asset.Name) to Gitee: $uploadResponse"
  }
  $uploaded = ($uploadResponse | Out-String) | ConvertFrom-Json
  if (-not $uploaded.browser_download_url) {
    throw "Gitee did not return a download URL for $($asset.Name)"
  }
  $giteeAssets[$asset.Name] = $uploaded
  Write-Host "Uploaded to Gitee: $($asset.Name)"
}

$setupDownloadUrl = [string]$giteeAssets[$setupAsset.Name].browser_download_url
if ([string]::IsNullOrWhiteSpace($setupDownloadUrl)) {
  throw "The Gitee installer download URL is missing"
}

$latest = Get-Content $githubLatestPath -Raw | ConvertFrom-Json
if (-not $latest.platforms.'windows-x86_64') {
  throw "GitHub latest.json has no windows-x86_64 platform entry"
}
$latest.platforms.'windows-x86_64'.url = $setupDownloadUrl
$giteeLatestPath = Join-Path $downloadDir "latest-gitee.json"
$latest | ConvertTo-Json -Depth 20 | Set-Content -Path $giteeLatestPath -Encoding utf8

$headers = @{
  Authorization = "Bearer $env:GITHUB_TOKEN"
  Accept = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
  "User-Agent" = "xml-viewer-release-workflow"
}
$branch = "updates"
$refUri = "https://api.github.com/repos/$githubRepo/git/ref/heads/$branch"
try {
  Invoke-RestMethod -Method Get -Uri $refUri -Headers $headers | Out-Null
} catch {
  $createRefBody = @{ ref = "refs/heads/$branch"; sha = $env:GITHUB_SHA } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$githubRepo/git/refs" -Headers $headers -Body $createRefBody -ContentType "application/json" | Out-Null
}

$contentsUri = "https://api.github.com/repos/$githubRepo/contents/latest.json?ref=$branch"
$existingSha = $null
try {
  $existingFile = Invoke-RestMethod -Method Get -Uri $contentsUri -Headers $headers
  $existingSha = $existingFile.sha
} catch {
  $existingSha = $null
}

$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Content $giteeLatestPath -Raw)))
$contentBody = @{
  message = "chore(updater): publish $tag Gitee manifest"
  content = $encoded
  branch = $branch
}
if ($existingSha) { $contentBody.sha = $existingSha }
Invoke-RestMethod -Method Put -Uri "https://api.github.com/repos/$githubRepo/contents/latest.json" -Headers $headers -Body ($contentBody | ConvertTo-Json -Compress) -ContentType "application/json" | Out-Null

Write-Host "Gitee release synced: $tag"
Write-Host "Gitee installer URL: $setupDownloadUrl"
Write-Host "Gitee updater manifest branch: $branch"
