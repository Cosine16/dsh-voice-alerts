param(
    [Parameter(Mandatory = $true)][string]$AudioPath,
    [ValidateRange(0, 100)][int]$Volume = 75
)
$ErrorActionPreference = 'Stop'
[byte[]]$bytes = [System.IO.File]::ReadAllBytes($AudioPath)
if ([System.Text.Encoding]::ASCII.GetString($bytes, 0, 4) -ne 'RIFF') { throw 'Expected a WAV file' }
$offset = 12
$pcm = $false
while ($offset + 8 -le $bytes.Length) {
    $tag = [System.Text.Encoding]::ASCII.GetString($bytes, $offset, 4)
    $size = [BitConverter]::ToInt32($bytes, $offset + 4)
    if ($size -lt 0 -or $offset + 8 + $size -gt $bytes.Length) { throw 'Invalid WAV chunk' }
    if ($tag -eq 'fmt ') {
        $pcm = [BitConverter]::ToInt16($bytes, $offset + 8) -eq 1 -and [BitConverter]::ToInt16($bytes, $offset + 22) -eq 16
    }
    if ($tag -eq 'data') {
        if (-not $pcm) { throw 'Expected 16-bit PCM audio' }
        for ($i = $offset + 8; $i + 1 -lt $offset + 8 + $size; $i += 2) {
            $sample = [int16]([BitConverter]::ToInt16($bytes, $i) * $Volume / 100)
            $scaled = [BitConverter]::GetBytes($sample)
            $bytes[$i] = $scaled[0]
            $bytes[$i + 1] = $scaled[1]
        }
        break
    }
    $offset += 8 + $size + ($size % 2)
}
$stream = New-Object System.IO.MemoryStream(,$bytes)
$player = New-Object System.Media.SoundPlayer($stream)
try { $player.PlaySync() } finally { $player.Dispose(); $stream.Dispose() }
