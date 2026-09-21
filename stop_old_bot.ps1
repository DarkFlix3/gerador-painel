$procs = Get-CimInstance Win32_Process -Filter "name='pythonw.exe'"
foreach ($p in $procs) {
    if ($p.CommandLine -match 'darkflix') {
        Write-Output ("Stopping PID=" + $p.ProcessId)
        Stop-Process -Id $p.ProcessId -Force
    }
}
Write-Output "done"