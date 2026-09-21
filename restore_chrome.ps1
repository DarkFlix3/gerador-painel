Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinApi {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@
$procs = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
foreach ($p in $procs) {
    $h = $p.MainWindowHandle
    $min = [WinApi]::IsIconic($h)
    [WinApi]::ShowWindow($h, 9) | Out-Null   # SW_RESTORE
    [WinApi]::ShowWindow($h, 3) | Out-Null   # SW_MAXIMIZE
    [WinApi]::SetForegroundWindow($h) | Out-Null
    Write-Output ("restaurado pid=" + $p.Id + " minimized=" + $min + " titulo=" + $p.MainWindowTitle)
}
