# Round Remote bridge helper for Windows: reads and controls every app that shows up in the Windows
# media flyout (Global System Media Transport Controls) — the Apple Music app, iTunes, Spotify, Cider,
# Sidra, Chrome/Edge/Firefox playing YouTube or YouTube Music, VLC, …
#
# Protocol (driven by bridge/adapters/winmedia.js):
#   stdout: one JSON line per update: {"type":"state","sessions":[…]} or {"type":"art","id":…,"mime":…,"data":base64}
#   stdin:  one JSON line per command: {"id":"<session id>","cmd":"play|pause|next|prev|seek|shuffle|repeat","value":…}
# Needs Windows 10 1809+ and Windows PowerShell 5.1 (powershell.exe — not PowerShell 7, which lacks the WinRT bridge).
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

# --- awaiting WinRT async operations from PowerShell ---------------------------------------------
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, [Type]$type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $task.Wait(4000)
  if ($task.IsCompleted) { return $task.Result } else { return $null }
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$Mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
if (-not $Mgr) { [Console]::Out.WriteLine('{"type":"error","message":"media session manager unavailable"}'); exit 1 }

$sentArt = @{}   # session id -> track key whose artwork was already sent

function Send($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6)); [Console]::Out.Flush() }

function SessionId($s) { return $s.SourceAppUserModelId }

function ReadArt($props) {
  try {
    if (-not $props.Thumbnail) { return $null }
    $stream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    if (-not $stream -or $stream.Size -eq 0 -or $stream.Size -gt 4MB) { return $null }
    $reader = [Windows.Storage.Streams.DataReader]::new($stream)
    $null = Await ($reader.LoadAsync([uint32]$stream.Size)) ([uint32])
    $bytes = New-Object byte[] ([int]$stream.Size)
    $reader.ReadBytes($bytes)
    $mime = $stream.ContentType
    $reader.Dispose(); $stream.Dispose()
    return @{ mime = $(if ($mime) { $mime } else { 'image/jpeg' }); data = [Convert]::ToBase64String($bytes) }
  } catch { return $null }
}

function Snapshot {
  $list = @()
  foreach ($s in $Mgr.GetSessions()) {
    try {
      $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $tl = $s.GetTimelineProperties()
      $pb = $s.GetPlaybackInfo()
      $id = SessionId $s
      $pos = $tl.Position.TotalMilliseconds
      $status = [string]$pb.PlaybackStatus
      # apps update the position now and then; move it on by the time since their last update
      if ($status -eq 'Playing' -and $tl.LastUpdatedTime.Year -gt 2000) {
        $pos += ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalMilliseconds
      }
      $key = "$($props.Title)|$($props.Artist)|$($props.AlbumTitle)"
      $list += @{
        id = $id; title = $props.Title; artist = $props.Artist; album = $props.AlbumTitle; albumArtist = $props.AlbumArtist
        status = $status; positionMs = [math]::Round($pos); durationMs = [math]::Round($tl.EndTime.TotalMilliseconds)
        shuffle = $pb.IsShuffleActive; repeat = [string]$pb.AutoRepeatMode
        canSeek = $pb.Controls.IsPlaybackPositionEnabled; canNext = $pb.Controls.IsNextEnabled; canPrev = $pb.Controls.IsPreviousEnabled
        canShuffle = $pb.Controls.IsShuffleEnabled; canRepeat = $pb.Controls.IsRepeatEnabled; trackKey = $key
      }
      if ($props.Title -and $sentArt[$id] -ne $key) {
        $sentArt[$id] = $key
        $art = ReadArt $props
        if ($art) { Send @{ type = 'art'; id = $id; trackKey = $key; mime = $art.mime; data = $art.data } }
      }
    } catch { }
  }
  Send @{ type = 'state'; sessions = @($list) }
}

function Find($id) { foreach ($s in $Mgr.GetSessions()) { if ((SessionId $s) -eq $id) { return $s } }; return $null }

function Run($line) {
  try {
    $c = $line | ConvertFrom-Json
    $s = Find $c.id
    if (-not $s) { return }
    switch ($c.cmd) {
      'play'    { $null = Await ($s.TryPlayAsync()) ([bool]) }
      'pause'   { $null = Await ($s.TryPauseAsync()) ([bool]) }
      'next'    { $null = Await ($s.TrySkipNextAsync()) ([bool]) }
      'prev'    { $null = Await ($s.TrySkipPreviousAsync()) ([bool]) }
      'seek'    { $null = Await ($s.TryChangePlaybackPositionAsync([long]([double]$c.value * 10000))) ([bool]) }  # ms -> 100 ns ticks
      'shuffle' { $null = Await ($s.TryChangeShuffleActiveAsync([bool]$c.value)) ([bool]) }
      'repeat'  {
        $m = switch ($c.value) { 'one' { [Windows.Media.MediaPlaybackAutoRepeatMode]::Track } 'all' { [Windows.Media.MediaPlaybackAutoRepeatMode]::List } default { [Windows.Media.MediaPlaybackAutoRepeatMode]::None } }
        $null = Await ($s.TryChangeAutoRepeatModeAsync($m)) ([bool])
      }
    }
  } catch { }
}

# --- main loop: commands as they arrive, a snapshot every second ---------------------------------
# (a StreamReader on the raw input stream: [Console]::In.ReadLineAsync() would block in PowerShell 5.1)
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
$pending = $stdin.ReadLineAsync()
$next = [DateTime]::Now
while ($true) {
  if ($pending.IsCompleted) {
    $line = $pending.Result
    if ($null -eq $line) { break }           # the bridge closed the pipe: exit
    Run $line
    $next = [DateTime]::Now.AddMilliseconds(150)  # report the change quickly
    $pending = $stdin.ReadLineAsync()
  }
  if ([DateTime]::Now -ge $next) { Snapshot; $next = [DateTime]::Now.AddSeconds(1) }
  Start-Sleep -Milliseconds 60
}
