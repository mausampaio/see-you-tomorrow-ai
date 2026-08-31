# ATENÇÃO AO SALVAR ESTE ARQUIVO: ele precisa de BOM UTF-8.
#
# O Windows PowerShell 5.1 (`powershell.exe`, o que existe por padrão no Windows) lê `.ps1`
# como ANSI quando não há BOM. Este arquivo tem travessões e acentos; sem o BOM eles viram
# mojibake, e o mojibake de um travessão dentro de string com aspas duplas quebra o parser
# inteiro — o erro que aparece é "'}' de fechamento ausente", apontando para chaves que estão
# perfeitamente balanceadas. Foi assim que este script falhou na primeira execução real.
#
# Se o seu editor salvar sem BOM, ou o arquivo passar por uma ferramenta que o remova, isto
# volta a quebrar. Alternativa, se algum dia o BOM for inconveniente: manter o arquivo em
# ASCII puro.
# Manual validation tool for docs/PLANO-DE-ENTREGA.md S4-T1's open question: does a Windows toast
# button with activationType="protocol" actually reach a registered `seeya://` URI handler when
# clicked? docs/spikes/B-notificacoes.md flagged this as "candidata preferida" but UNTESTED — it
# needs a real desktop and a real click, neither of which exists in the environment that built the
# adapter (`src/adapters/notification/`). The product itself never depends on this: the shipped
# `Notifier` contract is title + body only (docs/ESPECIFICACAO.md § "Notificações"). This script
# exists ONLY so a human can find out whether action buttons are worth building later.
#
# This is a standalone tool, not part of `src/` — it is never imported, built, or run by
# `npm run verificar`/`npm test`. It writes to the registry (HKCU, not HKLM — no admin needed) and
# shows a REAL toast, both of which the adapter's own tests are explicitly forbidden from doing
# (AGENTS.md's console-output exception for tooling scripts applies here: this file talks to the
# terminal on purpose, because it's an interactive instrument, not production code).
#
# Usage (from a PowerShell prompt, in the repo root):
#   powershell -ExecutionPolicy Bypass -File scripts\validate-windows-toast-protocol.ps1
#
# What to do when it runs:
#   1. A toast appears with a button labeled "Snooze 30 min".
#   2. Click that button (not just the toast body — the button specifically).
#   3. Re-run this same script with `-CheckOnly` to see whether Windows invoked the registered
#      handler with the right URI:
#        powershell -ExecutionPolicy Bypass -File scripts\validate-windows-toast-protocol.ps1 -CheckOnly
#   4. Report back: did the log file exist, and did it contain `seeya://snooze30`?
#
# Cleanup (removes the registry key this script adds — nothing else on the machine is touched):
#   Remove-Item -Path 'HKCU:\Software\Classes\seeya' -Recurse -Force

param(
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

$logFile = Join-Path $env:TEMP 'seeya-toast-protocol-validation.log'

if ($CheckOnly) {
    if (Test-Path $logFile) {
        Write-Output "Log file found at: $logFile"
        Write-Output '--- contents ---'
        Get-Content $logFile
        Write-Output '----------------'
        Write-Output 'If a line above contains "seeya://snooze30", the protocol activation worked.'
    } else {
        Write-Output "No log file at $logFile yet — the button was not clicked, or the handler never ran."
    }
    exit 0
}

# Registers `seeya://<anything>` under the CURRENT USER (HKCU) — no admin rights needed, and
# nothing outside this one key is touched. The handler just appends the received URI to a log
# file: this script only needs to know THAT Windows invoked it and with WHAT argument, not to run
# any real seeya behavior (D-020: this script is not part of the composition root, and the product
# has no `seeya://` handling to invoke yet regardless — see this file's own top comment).
$handlerCommand = "cmd.exe /c echo %1>>`"$logFile`""
New-Item -Path 'HKCU:\Software\Classes\seeya' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Classes\seeya' -Name '(Default)' -Value 'URL:seeya protocol'
Set-ItemProperty -Path 'HKCU:\Software\Classes\seeya' -Name 'URL Protocol' -Value ''
New-Item -Path 'HKCU:\Software\Classes\seeya\shell\open\command' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Classes\seeya\shell\open\command' -Name '(Default)' -Value $handlerCommand

Write-Output "Registered seeya:// under HKCU. Handler logs to: $logFile"

# Same two WinRT types docs/spikes/B-notificacoes.md and `src/adapters/notification/windows-toast.ts`
# already load — loading only one fails with a PSArgumentException pointing at the other.
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

# The ONE difference from production's toast (`buildToastXml`): an <actions> block with a single
# protocol-activated button. Production never emits this element (no action buttons in this task's
# contract) — this script exists specifically to test the element production does NOT use yet.
$toastXml = @'
<toast activationType="protocol">
  <visual>
    <binding template="ToastGeneric">
      <text>seeya (validation)</text>
      <text>Click the button below, then run this script again with -CheckOnly.</text>
    </binding>
  </visual>
  <actions>
    <action content="Snooze 30 min" arguments="seeya://snooze30" activationType="protocol" />
  </actions>
</toast>
'@

$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($toastXml)
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId)
$notifier.Show([Windows.UI.Notifications.ToastNotification]::new($doc))

Write-Output 'Toast shown. Click "Snooze 30 min", then re-run with -CheckOnly.'
