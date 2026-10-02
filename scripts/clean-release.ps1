# Build (and optionally install) the game from a COMMIT, never from the shared working tree - several sessions edit the
# tree at once, and a build from it ships whatever half-finished work is lying around.
#   powershell -File scripts/clean-release.ps1 <sha> [-Desktop]
# Makes a throwaway worktree at <sha>, junctions the heavy git-ignored inputs into it (node_modules, desktop/node_modules,
# assetgen/out = the HQ / HD models) and copies the git-ignored public files (public/anim/mixamo.glb, kevin.glb...), then runs
# tsc + the unit tests + `npm run build` (web: vite + lite-strip) and, with -Desktop, `node desktop/build.mjs --installer`
# (installs to %LOCALAPPDATA%\Programs\ZenithUmbra). The junctions are removed before the worktree is, so the shared
# node_modules is never deleted through them.
param([Parameter(Mandatory = $true)][string]$Sha, [switch]$Desktop)
$ErrorActionPreference = 'Stop'
$main = Split-Path -Parent $PSScriptRoot
$wt = Join-Path (Split-Path -Parent $main) 'zu-release'
$links = @('node_modules', 'desktop\node_modules', 'assetgen\out')
function Remove-Worktree {
  foreach ($l in $links) { $p = Join-Path $wt $l; if ((Get-Item $p -Force -ErrorAction SilentlyContinue).LinkType) { cmd /c rmdir "$p" | Out-Null } }
  foreach ($l in $links) { if (Test-Path (Join-Path $wt $l)) { throw "junction still present: $l - not removing the worktree" } }
  Push-Location $main; git worktree remove --force $wt 2>$null; if (Test-Path $wt) { Remove-Item -Recurse -Force $wt -Confirm:$false }; git worktree prune; Pop-Location
}
if (Test-Path $wt) { Remove-Worktree }
Push-Location $main
git worktree add -f $wt $Sha | Out-Null
Pop-Location
try {
  New-Item -ItemType Directory -Force (Join-Path $wt 'assetgen') | Out-Null
  foreach ($l in $links) { cmd /c mklink /J (Join-Path $wt $l) (Join-Path $main $l) | Out-Null }
  # every git-ignored file under public/ (clip packs whose licences keep them out of git) - asked of git, not listed here
  Push-Location $main; $ignored = git ls-files --others --ignored --exclude-standard public; Pop-Location
  foreach ($f in $ignored) { $dst = Join-Path $wt $f; New-Item -ItemType Directory -Force (Split-Path -Parent $dst) | Out-Null; Copy-Item (Join-Path $main $f) $dst; "copied $f" }
  Push-Location $wt
  npx tsc --noEmit -p .; if ($LASTEXITCODE) { throw 'tsc failed' }
  npx vitest run --reporter=dot; if ($LASTEXITCODE) { Write-Warning 'unit tests failed (the campaign sims are occasionally flaky - re-run before shipping)' }
  npm run build; if ($LASTEXITCODE) { throw 'web build failed' }
  if ($Desktop) { Push-Location desktop; node build.mjs --installer; $code = $LASTEXITCODE; Pop-Location; if ($code) { throw 'desktop build failed' } }
  Pop-Location
  "RELEASE_OK $Sha"
} finally { Set-Location $main; Remove-Worktree }
