# Captures the top-left of the WoW client window and decodes the WowGrok pixel strip.
# Prints one JSON object per new message. -TestImage decodes a still image and exits.

param(
  [int]$Cell = 4,
  [int]$Cells = 200,
  [int]$MaxRows = 48,
  [int]$IntervalMs = 250,
  [string]$ProcessName = "Wow",
  [string]$TestImage = ""
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WowGrokCap {
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
"@
[void][WowGrokCap]::SetProcessDPIAware()

function Emit($obj) {
  [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject $obj))
  [Console]::Out.Flush()
}

function CellValue($bmp, [int]$c, [int]$r) {
  $px = $bmp.GetPixel($c * $Cell + [int]($Cell / 2), $r * $Cell + [int]($Cell / 2))
  $v = 0
  if ($px.R -ge 128) { $v += 4 }
  if ($px.G -ge 128) { $v += 2 }
  if ($px.B -ge 128) { $v += 1 }
  return $v
}

function Decode($bmp) {
  $acc = 0
  $nbits = 0
  $bytes = New-Object System.Collections.Generic.List[int]
  $needed = 6
  $total = $Cells * $MaxRows
  $maxBytes = [int]($total * 3 / 8)
  for ($i = 0; $i -lt $total; $i++) {
    $c = $i % $Cells
    $r = [int][Math]::Floor($i / $Cells)
    if (($r * $Cell + [int]($Cell / 2)) -ge $bmp.Height) { break }
    if (($c * $Cell + [int]($Cell / 2)) -ge $bmp.Width) { break }
    $v = CellValue $bmp $c $r
    $acc = $acc * 8 + $v
    $nbits += 3
    while ($nbits -ge 8 -and $bytes.Count -lt $needed) {
      $shift = $nbits - 8
      $div = [Math]::Pow(2, $shift)
      $b = [int]([Math]::Floor($acc / $div) % 256)
      $bytes.Add($b)
      $nbits = $shift
      $acc = [int]($acc % $div)
      if ($bytes.Count -eq 2) {
        if ($bytes[0] -ne 0xC7 -or $bytes[1] -ne 0x1A) { return $null }
      }
      if ($bytes.Count -eq 6) {
        $len = ($bytes[4] * 256) + $bytes[5]
        $needed = 8 + $len
        if ($needed -gt $maxBytes) { return @{ error = "length" } }
      }
    }
    if ($bytes.Count -ge $needed) { break }
  }
  if ($bytes.Count -lt $needed) { return $null }
  $len = ($bytes[4] * 256) + $bytes[5]
  $s1 = 0
  $s2 = 0
  for ($k = 2; $k -lt (6 + $len); $k++) {
    $s1 = ($s1 + $bytes[$k]) % 255
    $s2 = ($s2 + $s1) % 255
  }
  if ($bytes[6 + $len] -ne $s1 -or $bytes[7 + $len] -ne $s2) { return @{ error = "checksum" } }
  $payload = New-Object byte[] $len
  for ($k = 0; $k -lt $len; $k++) { $payload[$k] = [byte]$bytes[6 + $k] }
  return @{ id = (($bytes[2] * 256) + $bytes[3]); text = [Text.Encoding]::UTF8.GetString($payload) }
}

if ($TestImage -ne "") {
  $bmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path $TestImage))
  $msg = Decode $bmp
  $bmp.Dispose()
  if ($msg) { Emit $msg } else { Emit @{ error = "no valid strip in image" } }
  exit 0
}

$lastKey = ""
$lastWarn = [DateTime]::MinValue
$proc = $null
$w = $Cells * $Cell
$h = $MaxRows * $Cell
while ($true) {
  if (-not $proc -or $proc.HasExited) {
    $proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if (-not $proc) {
      Emit @{ info = "waiting for $ProcessName window" }
      Start-Sleep -Seconds 3
      continue
    }
    Emit @{ info = "attached to '$($proc.MainWindowTitle)' (pid $($proc.Id))" }
  }
  $hwnd = $proc.MainWindowHandle
  if ([WowGrokCap]::IsIconic($hwnd)) { Start-Sleep -Milliseconds 1000; continue }
  $pt = New-Object WowGrokCap+POINT
  [void][WowGrokCap]::ClientToScreen($hwnd, [ref]$pt)
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $ok = $true
  try { $g.CopyFromScreen($pt.X, $pt.Y, 0, 0, $bmp.Size) } catch { $ok = $false }
  $g.Dispose()
  if ($ok) {
    $msg = Decode $bmp
    if ($msg -and $msg.error) {
      if (([DateTime]::Now - $lastWarn).TotalSeconds -ge 5) {
        $lastWarn = [DateTime]::Now
        Emit @{ warn = "strip seen but rejected: $($msg.error)" }
      }
    } elseif ($msg) {
      $key = "$($msg.id):$($msg.text)"
      if ($key -ne $lastKey) {
        $lastKey = $key
        Emit $msg
      }
    }
  }
  $bmp.Dispose()
  Start-Sleep -Milliseconds $IntervalMs
}
