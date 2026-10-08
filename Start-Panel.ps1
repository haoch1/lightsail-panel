param([switch]$Dev)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeCmd=Get-Command node -ErrorAction SilentlyContinue
$nodeTool=if($nodeCmd){$nodeCmd.Source}else{Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'}
$pnpmCmd=Get-Command pnpm,pnpm.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
$pnpmTool=if($pnpmCmd){$pnpmCmd.Source}else{Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd'}
if(!(Test-Path -LiteralPath $nodeTool) -or !(Test-Path -LiteralPath $pnpmTool)){throw '请先安装 Node.js 24+ 与 pnpm 11.25.0。'}
$nodeMajor=[int]((& $nodeTool --version).TrimStart('v').Split('.')[0])
if($nodeMajor -lt 24){throw '需要 Node.js 24 或更新版本。'}
$env:PATH=(Split-Path -Parent $nodeTool)+';'+$env:PATH
if(!(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))){& $pnpmTool install --frozen-lockfile;if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}}
if($Dev){Write-Host '开发界面：http://127.0.0.1:4173/'; & $nodeTool scripts/dev.mjs}
else{& $pnpmTool run build;if($LASTEXITCODE -ne 0){exit $LASTEXITCODE};Write-Host '面板：http://127.0.0.1:4180/';Write-Host '演示：http://127.0.0.1:4180/lightsail?demo=1'; & $nodeTool server/index.mjs}
