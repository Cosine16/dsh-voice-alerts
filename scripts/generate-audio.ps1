param([string]$Voice = 'Microsoft Zira Desktop', [string]$Only = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$root = Split-Path $PSScriptRoot -Parent
$audioDir = Join-Path $root 'audio'
New-Item -ItemType Directory -Force -Path $audioDir | Out-Null
$phrases = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'phrases.json') -Raw | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $synth.SelectVoice($Voice)
    $synth.Rate = -1
    $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    foreach ($entry in $phrases.PSObject.Properties) {
        if ($Only -and $entry.Name -ne $Only) { continue }
        $synth.SetOutputToWaveFile((Join-Path $audioDir ($entry.Name + '.wav')), $format)
        $synth.Speak($entry.Value)
        $synth.SetOutputToNull()
        Write-Output ($entry.Name + '.wav')
    }
} finally { $synth.Dispose() }
