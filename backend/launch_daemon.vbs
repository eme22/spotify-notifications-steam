Set shell = CreateObject("WScript.Shell")
Dim action
action = WScript.Arguments(0)

' Silently stop any pre-existing media_daemon.ps1 processes
shell.Run "powershell -NoProfile -NonInteractive -Command ""Get-CimInstance Win32_Process -Filter \""Name='powershell.exe'\"" | Where-Object CommandLine -Like '*media_daemon.ps1*' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }""", 0, True

If LCase(action) <> "stop" Then
    ' Silently start the media_daemon.ps1 process
    shell.Run "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & action & """", 0, False
End If
