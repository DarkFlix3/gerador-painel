# manage_bot.ps1 — gestão do stack de vendas (bot.js + túnel cloudflared + URL pública)
# Uso:
#   .\manage_bot.ps1             -> status resumido
#   .\manage_bot.ps1 list        -> lista processos node/cloudflared
#   .\manage_bot.ps1 stop-bot    -> para só o bot (API fica de pé)
#   .\manage_bot.ps1 start-bot   -> sobe o bot se estiver parado
#   .\manage_bot.ps1 restart-bot -> reinicia o bot
#   .\manage_bot.ps1 tunnel      -> status/URL do túnel
#   .\manage_bot.ps1 stack       -> roda o stack_start.ps1 (sobe tudo, sincroniza URL)
param([string]$Action = "status")

$proj = 'C:\Users\Chrys\.gemini\antigravity\scratch\gerador-painel'
$tools = Join-Path $proj 'tools'
$node  = 'C:\Program Files\nodejs\node.exe'

function Get-NodeProcs {
  Get-CimInstance Win32_Process -Filter "name='node.exe'" -ErrorAction SilentlyContinue
}
function Get-BotProc { (Get-NodeProcs | Where-Object { $_.CommandLine -match 'bot\.js' }) }
function Get-ApiProc { (Get-NodeProcs | Where-Object { $_.CommandLine -match 'server\.js' }) }

switch ($Action) {
  "list" {
    Write-Output '--- node.exe ---'
    foreach ($p in Get-NodeProcs) {
      $kind = if ($p.CommandLine -match 'bot\.js') { '[bot]' } elseif ($p.CommandLine -match 'server\.js') { '[api] (mantido)' } else { '[out]' }
      Write-Output ("  " + $kind + " PID=" + $p.ProcessId)
    }
    Write-Output '--- cloudflared ---'
    $cf = Get-Process cloudflared -ErrorAction SilentlyContinue
    if ($cf) { $cf | ForEach-Object { Write-Output ("  [tun] PID=" + $_.Id) } } else { Write-Output '  (sem túnel)' }
    Write-Output 'done'
  }
  "stop-bot" {
    $bp = Get-BotProc
    if ($bp) { $bp | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Output ("  bot PID=" + $_.ProcessId + " parado") } }
    else { Write-Output '  bot já estava parado' }
    Write-Output 'done'
  }
  "start-bot" {
    $bp = Get-BotProc
    if ($bp) { Write-Output '  bot já está rodando' }
    else {
      Start-Process -FilePath $node -ArgumentList 'bot.js' -WorkingDirectory $proj -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $proj 'bot_stdout.log') -RedirectStandardError (Join-Path $proj 'bot_stderr.log')
      Write-Output '  bot iniciado'
    }
    Write-Output 'done'
  }
  "restart-bot" {
    $bp = Get-BotProc
    if ($bp) { $bp | ForEach-Object { Stop-Process -Id $_.ProcessId -Force } ; Write-Output '  bot parado' }
    Start-Sleep -Seconds 1
    Start-Process -FilePath $node -ArgumentList 'bot.js' -WorkingDirectory $proj -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $proj 'bot_stdout.log') -RedirectStandardError (Join-Path $proj 'bot_stderr.log')
    Write-Output '  bot reiniciado'
    Write-Output 'done'
  }
  "tunnel" {
    $cf = Get-Process cloudflared -ErrorAction SilentlyContinue
    if ($cf) {
      $m = Select-String -Path (Join-Path $tools 'tunnel.log') -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
      $url = if ($m -and $m.Matches.Count -gt 0) { $m.Matches[0].Value } else { '(URL não localizada no log)' }
      Write-Output ("  [tun] rodando PID=" + $cf.Id + " URL=" + $url)
    } else { Write-Output '  [tun] parado' }
    Write-Output 'done'
  }
  "stack" {
    & (Join-Path $proj 'stack_start.ps1')
  }
  default {
    Write-Output '--- status ---'
    $bp = Get-BotProc; $ap = Get-ApiProc; $cf = Get-Process cloudflared -ErrorAction SilentlyContinue
    if ($bp) { Write-Output ('  [bot] rodando PID=' + $bp.ProcessId) } else { Write-Output '  [bot] PARADO' }
    if ($ap) { Write-Output ('  [api] rodando PID=' + $ap.ProcessId) } else { Write-Output '  [api] PARADO' }
    if ($cf) { Write-Output ('  [tun] rodando PID=' + $cf.Id) } else { Write-Output '  [tun] PARADO' }
    Write-Output ''
    Write-Output '  Dica: .\manage_bot.ps1 stack   (sobe tudo e sincroniza a URL)'
    Write-Output 'done'
  }
}