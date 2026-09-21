# stack_start.ps1 — sobe/garante o stack completo de vendas:
#   cloudflared (túnel HTTPS publico) -> atualiza app_base_url (SQLite) + PUBLIC_BASE_URL (.env) -> bot.js
# Idempotente: pode rodar no login (autostart) ou manualmente. Sem admin necessario.

$ErrorActionPreference = 'Continue'
$proj = 'C:\Users\Chrys\.gemini\antigravity\scratch\gerador-painel'
$tools = Join-Path $proj 'tools'
$cf    = Join-Path $tools 'cloudflared.exe'
$state = Join-Path $proj '.tunnel_url'
$node  = 'C:\Program Files\nodejs\node.exe'
$tlog  = Join-Path $tools 'tunnel.log'
$terr  = Join-Path $tools 'tunnel_err.log'

function Get-TunnelUrl {
  $m = Select-String -Path $tlog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($m -and $m.Matches.Count -gt 0) { return $m.Matches[0].Value.Trim() }
  return $null
}
function Get-UrlState  { Get-Content $state -ErrorAction SilentlyContinue | Select-Object -First 1 }
function Test-Tunnel { [bool](Get-Process cloudflared -ErrorAction SilentlyContinue) }
function Test-Bot {
  $p = Get-CimInstance Win32_Process -Filter "name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'bot\.js' }
  return [bool]$p
}

# ---- 1) TUNNEL ----
if (-not (Test-Tunnel)) {
  Write-Output '[tun] cloudflared parado -> iniciando...'
  Start-Process -FilePath $cf -ArgumentList 'tunnel','--url','http://localhost:3000','--no-autoupdate' `
    -WorkingDirectory $tools -WindowStyle Hidden `
    -RedirectStandardOutput $tlog -RedirectStandardError $terr
} else {
  Write-Output '[tun] cloudflared ja rodando.'
}

$url = $null
for ($i = 0; $i -lt 90 -and -not $url; $i++) {
  Start-Sleep -Milliseconds 500
  $url = Get-TunnelUrl
}
if (-not $url) {
  Write-Output '[tun] ERRO: nenhuma URL trycloudflare detectada no log.'
} else {
  Write-Output ("[tun] URL publica: " + $url)
}

# ---- 2) BASE URL (banco + .env) ----
$prev = Get-UrlState
if ($url -and $url -ne $prev) {
  Write-Output ('[cfg] URL mudou (' + $prev + ' -> ' + $url + ') atualizando banco/.env...')
  & $node (Join-Path $tools 'update_base_url.js') $url
  Set-Content -Path $state -Value $url
  # .env mudou -> reinicia o bot para pegar a nova PUBLIC_BASE_URL
  $bp = Get-CimInstance Win32_Process -Filter "name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'bot\.js' }
  if ($bp) { Stop-Process -Id $bp.ProcessId -Force; Write-Output '[cfg] bot reiniciado para nova URL' }
} elseif ($url) {
  Write-Output '[cfg] URL inalterada. Nada a atualizar.'
}

# ---- 3) BOT ----
if (-not (Test-Bot)) {
  Write-Output '[bot] parado -> iniciando (oculto)...'
  Start-Process -FilePath $node -ArgumentList 'bot.js' -WorkingDirectory $proj -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $proj 'bot_stdout.log') -RedirectStandardError (Join-Path $proj 'bot_stderr.log')
} else {
  Write-Output '[bot] ja rodando.'
}
Start-Sleep -Seconds 2

# ---- 4) STATUS ----
Write-Output '---- status ----'
if (Test-Tunnel) { Write-Output ('[tun] OK  -> ' + (Get-TunnelUrl)) } else { Write-Output '[tun] FALHOU' }
if (Test-Bot) { Write-Output '[bot] OK rodando.' } else { Write-Output '[bot] FALHOU' }
Write-Output 'done'