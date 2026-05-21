Add-Type -AssemblyName "System.Runtime.WindowsRuntime"

# Register WinRT type metadata
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control.SystemMediaTransportControls, ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSession, Windows.Media.Control.SystemMediaTransportControls, ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control.SystemMediaTransportControls, ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionTimelineProperties, Windows.Media.Control.SystemMediaTransportControls, ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackInfo, Windows.Media.Control.SystemMediaTransportControls, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Foundation.UniversalApiContract, ContentType=WindowsRuntime] | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | 
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

$asStreamMethod = [System.IO.WindowsRuntimeStreamExtensions].GetMethods() | 
    Where-Object { $_.Name -eq 'AsStream' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IRandomAccessStream' }

function Await-WinRT {
    param(
        [Parameter(Mandatory=$true)] $WinRtTask,
        [Parameter(Mandatory=$true)] [Type] $ResultType
    )
    try {
        $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
        $netTask = $asTask.Invoke($null, @($WinRtTask))
        $netTask.Wait(-1) | Out-Null
        return $netTask.Result
    } catch {
        return $null
    }
}

$stateFile = "$PSScriptRoot\media_state.json"
$commandFile = "$PSScriptRoot\media_command.txt"

# Ensure any old command file is cleaned up at start
if (Test-Path $commandFile) { Remove-Item $commandFile -Force }

while ($true) {
    try {
        # 1. Fetch Windows Media Session Manager
        $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
        $asyncOp = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
        $manager = Await-WinRT $asyncOp $managerType
        
        $session = $null
        if ($manager) {
            $session = $manager.GetCurrentSession()
        }
        
        if ($session) {
            # 2. Check for inbound control commands
            if (Test-Path $commandFile) {
                try {
                    $cmd = (Get-Content $commandFile -Raw).Trim().ToLower()
                    Remove-Item $commandFile -Force
                    
                    if ($cmd -eq "play") {
                        $null = Await-WinRT ($session.TryPlayAsync()) ([System.Boolean])
                    } elseif ($cmd -eq "pause") {
                        $null = Await-WinRT ($session.TryPauseAsync()) ([System.Boolean])
                    } elseif ($cmd -eq "next") {
                        $null = Await-WinRT ($session.TrySkipNextAsync()) ([System.Boolean])
                    } elseif ($cmd -eq "previous") {
                        $null = Await-WinRT ($session.TrySkipPreviousAsync()) ([System.Boolean])
                    }
                    
                    # Short sleep to let Windows state propagate before querying properties
                    Start-Sleep -Milliseconds 100
                } catch {
                    # Ignore control exceptions
                }
            }
            
            # 3. Retrieve playback properties
            $propType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
            $propAsync = $session.TryGetMediaPropertiesAsync()
            $props = Await-WinRT $propAsync $propType
            
            $timeline = $session.GetTimelineProperties()
            $playbackInfo = $session.GetPlaybackInfo()
            
            if ($props -and $props.Title) {
                # 4. Extract base64 thumbnail if available
                $thumbnailBase64 = ""
                if ($props.Thumbnail) {
                    try {
                        $streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]
                        $streamAsync = $props.Thumbnail.OpenReadAsync()
                        $stream = Await-WinRT $streamAsync $streamType
                        if ($stream) {
                            $netStream = $asStreamMethod.Invoke($null, @($stream))
                            if ($netStream) {
                                $memoryStream = New-Object System.IO.MemoryStream
                                $netStream.CopyTo($memoryStream)
                                $buf = $memoryStream.ToArray()
                                $netStream.Close()
                                $memoryStream.Close()
                                $thumbnailBase64 = [Convert]::ToBase64String($buf)
                            }
                        }
                    } catch {
                        # Suppress thumbnail extraction exceptions
                    }
                }
                
                # Format properties as JSON expected by monitoring.ts
                $trackObj = [PSCustomObject]@{
                    title = $props.Title
                    artist = $props.Artist
                    album = $props.AlbumTitle
                    duration = [int]$timeline.EndTime.TotalMilliseconds
                    progress = [int]$timeline.Position.TotalMilliseconds
                    status = $playbackInfo.PlaybackStatus.ToString()
                    image = $thumbnailBase64
                }
                $json = $trackObj | ConvertTo-Json -Compress
                Set-Content -Path $stateFile -Value $json -Force
            } else {
                Set-Content -Path $stateFile -Value "null" -Force
            }
        } else {
            Set-Content -Path $stateFile -Value "null" -Force
        }
    } catch {
        Set-Content -Path $stateFile -Value "null" -Force
    }
    
    # Poll every 1 second
    Start-Sleep -Seconds 1
}
