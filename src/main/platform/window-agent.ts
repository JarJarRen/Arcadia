/**
 * The window agent, as PowerShell source.
 *
 * A string rather than a .ps1 file so that nothing extra has to be
 * packaged: `electron-builder.yml` ships `out/**` and this compiles into
 * it. It is fed to `powershell.exe -Command -` on stdin.
 *
 * **It must contain no backtick and no `${`.** Both are ordinary
 * PowerShell — the backtick is its escape character — and both would
 * break the TypeScript template literal holding them. `windows.test.ts`
 * asserts this rather than trusting it.
 *
 * Everything the script needs arrives in environment variables. Nothing is
 * interpolated into the source, so no path, title or handle can alter what
 * the script does.
 *
 * Why C# helpers rather than PowerShell delegates: enumerating windows
 * needs an EnumWindows callback, and marshalling a scriptblock into one is
 * both slower and far more fragile than letting the compiled type collect
 * the handles itself.
 */
export const WINDOW_AGENT_SCRIPT = `
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

[StructLayout(LayoutKind.Sequential)]
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

[StructLayout(LayoutKind.Sequential)]
public struct MONITORINFO {
  public int cbSize;
  public RECT rcMonitor;
  public RECT rcWork;
  public int dwFlags;
}

public static class U {
  public delegate bool EnumProc(IntPtr window, IntPtr param);

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern int GetWindowTextLengthW(IntPtr window);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr window, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] public static extern int GetWindowLongValue(IntPtr window, int index);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

  public static IntPtr[] TopLevel() {
    List<IntPtr> found = new List<IntPtr>();
    EnumWindows(delegate(IntPtr window, IntPtr param) { found.Add(window); return true; }, IntPtr.Zero);
    return found.ToArray();
  }

  public static string Title(IntPtr window) {
    int length = GetWindowTextLengthW(window);
    if (length <= 0) return "";
    StringBuilder text = new StringBuilder(length + 1);
    GetWindowTextW(window, text, text.Capacity);
    return text.ToString();
  }

  public static uint Pid(IntPtr window) {
    uint processId;
    GetWindowThreadProcessId(window, out processId);
    return processId;
  }
}
"@

# Without this a scaled monitor hands the process virtualised coordinates
# and every rectangle below is silently wrong. V2 first, the older call as
# the fallback for anything before Windows 10 1703.
try { [void][U]::SetProcessDpiAwarenessContext([IntPtr](-4)) }
catch { try { [void][U]::SetProcessDPIAware() } catch { } }

# ConvertFrom-Json hands a JSON array to the pipeline as one item, not one
# item per element, so wrapping the call in @() does not pin down an array —
# it collects that single item into an array of one, nesting the real array
# a level deeper instead. This read like a correctness guard; it was the
# opposite, and the direct assignment below is the form that actually
# unwraps to a flat array.
$names   = $env:ARCADIA_AGENT_PROCESSES | ConvertFrom-Json
$ignore  = $env:ARCADIA_AGENT_IGNORE_TITLES | ConvertFrom-Json
$target  = $env:ARCADIA_AGENT_TARGET | ConvertFrom-Json
$argv    = $env:ARCADIA_AGENT_ARGS | ConvertFrom-Json
$exe     = $env:ARCADIA_AGENT_EXE
$owner   = [IntPtr][int64]$env:ARCADIA_AGENT_OWNER
$timeout = [int]$env:ARCADIA_AGENT_TIMEOUT_MS
$settle  = [int]$env:ARCADIA_AGENT_SETTLE_MS

$SWP_NOSIZE     = 0x0001
$SWP_NOMOVE     = 0x0002
$SWP_NOACTIVATE = 0x0010
$SWP_SHOWWINDOW = 0x0040
$HWND_TOP       = [IntPtr]0
$HWND_TOPMOST   = [IntPtr](-1)
$HWND_NOTOPMOST = [IntPtr](-2)

# Written straight to the console rather than down the pipeline: the parent
# acts on 'started' before anything else happens, so it must not sit in a
# buffer waiting for the process to end.
function Emit($payload) {
  [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

function Get-StorePids {
  $ids = @{}
  foreach ($process in (Get-Process -ErrorAction SilentlyContinue)) {
    if ($names -contains $process.ProcessName.ToLower()) { $ids[[uint32]$process.Id] = $true }
  }
  return $ids
}

# Every window of a store process, filtered by nothing. This is the "before"
# picture, and a window missing from it would later look new.
function Get-AllStoreWindows {
  $ids = Get-StorePids
  $found = @{}
  foreach ($window in [U]::TopLevel()) {
    if ($ids.ContainsKey([U]::Pid($window))) { $found[[int64]$window] = $true }
  }
  return $found
}

# A window that appeared after the launch and could plausibly be a dialog.
# Identified by being new, never by its title: title matching would break on
# the next Steam release and would need a translation per language.
function Get-NewStoreWindows($seen) {
  $ids = Get-StorePids
  $candidates = @()
  foreach ($window in [U]::TopLevel()) {
    if ($seen.ContainsKey([int64]$window)) { continue }
    if (-not [U]::IsWindowVisible($window)) { continue }
    if (-not $ids.ContainsKey([U]::Pid($window))) { continue }

    $title = [U]::Title($window)
    if ($title -eq '') { continue }
    if ($ignore -contains $title) { continue }

    # WS_EX_TOOLWINDOW, via GWL_EXSTYLE. Steam keeps a number of these
    # around for its own bookkeeping.
    if (([U]::GetWindowLongValue($window, -20) -band 0x00000080) -ne 0) { continue }

    $rect = New-Object RECT
    if (-not [U]::GetWindowRect($window, [ref]$rect)) { continue }
    if (($rect.Right - $rect.Left) -lt 200) { continue }
    if (($rect.Bottom - $rect.Top) -lt 150) { continue }

    $candidates += $window
  }
  return $candidates
}

function Set-Centred($window) {
  $rect = New-Object RECT
  if (-not [U]::GetWindowRect($window, [ref]$rect)) { return $false }
  $width  = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top

  $info = New-Object MONITORINFO
  $info.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($info)
  $monitor = [U]::MonitorFromWindow($owner, 2)
  $work = $null
  if ([U]::GetMonitorInfo($monitor, [ref]$info)) { $work = $info.rcWork }

  $x = [int]($target.x + ($target.width - $width) / 2)
  $y = [int]($target.y + ($target.height - $height) / 2)

  # Clamped into the work area so a dialog larger than Arcadia, or an
  # Arcadia half off-screen, cannot push it under the taskbar or past the
  # edge of the monitor.
  if ($null -ne $work) {
    $x = [Math]::Max($work.Left, [Math]::Min($x, $work.Right - $width))
    $y = [Math]::Max($work.Top, [Math]::Min($y, $work.Bottom - $height))
  }

  $moved = [U]::SetWindowPos($window, $HWND_TOP, $x, $y, 0, 0, ($SWP_NOSIZE -bor $SWP_SHOWWINDOW))

  # Topmost and straight back again. That lifts the window to the front of
  # the z-order without this process needing to own the foreground lock,
  # which as a background process it does not.
  $flags = ($SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_NOACTIVATE)
  [void][U]::SetWindowPos($window, $HWND_TOPMOST, 0, 0, 0, 0, $flags)
  [void][U]::SetWindowPos($window, $HWND_NOTOPMOST, 0, 0, 0, 0, $flags)

  # Focus on top of that where Windows allows it. A refusal costs nothing:
  # the window is already visible and the first click will focus it.
  [void][U]::SetForegroundWindow($window)

  return $moved
}

$seen = Get-AllStoreWindows

try {
  if ($argv.Count -gt 0) { Start-Process -FilePath $exe -ArgumentList $argv | Out-Null }
  else { Start-Process -FilePath $exe | Out-Null }
  Emit @{ event = 'started'; ok = $true }
} catch {
  Emit @{ event = 'started'; ok = $false; reason = 'spawn'; detail = $_.Exception.Message }
  Emit @{ event = 'done' }
  exit 0
}

$wizard = $null
$deadline = [DateTime]::UtcNow.AddMilliseconds($timeout)
while ([DateTime]::UtcNow -lt $deadline) {
  $candidates = Get-NewStoreWindows $seen
  if ($candidates.Count -gt 0) { $wizard = $candidates[0]; break }
  Start-Sleep -Milliseconds 250
}

if ($null -eq $wizard) {
  Emit @{ event = 'placed'; ok = $false; reason = 'timeout' }
  Emit @{ event = 'done' }
  exit 0
}

if (Set-Centred $wizard) { Emit @{ event = 'placed'; ok = $true; hwnd = [int64]$wizard } }
else { Emit @{ event = 'placed'; ok = $false; reason = 'denied' } }
$seen[[int64]$wizard] = $true

# Belt and braces for -silent not being honoured: anything else the store
# opens from here goes directly below Arcadia instead of over it.
$settleEnd = [DateTime]::UtcNow.AddMilliseconds($settle)
while ([DateTime]::UtcNow -lt $settleEnd) {
  foreach ($window in (Get-NewStoreWindows $seen)) {
    [void][U]::SetWindowPos($window, $owner, 0, 0, 0, 0, ($SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_NOACTIVATE))
    $seen[[int64]$window] = $true
  }
  Start-Sleep -Milliseconds 250
}

Emit @{ event = 'done' }
`
