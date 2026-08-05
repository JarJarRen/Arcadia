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
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
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
$names     = $env:ARCADIA_AGENT_PROCESSES | ConvertFrom-Json
$ignore    = $env:ARCADIA_AGENT_IGNORE_TITLES | ConvertFrom-Json
$target    = $env:ARCADIA_AGENT_TARGET | ConvertFrom-Json
$argv      = $env:ARCADIA_AGENT_ARGS | ConvertFrom-Json
$exe       = $env:ARCADIA_AGENT_EXE
$owner     = [IntPtr][int64]$env:ARCADIA_AGENT_OWNER
$timeout   = [int]$env:ARCADIA_AGENT_TIMEOUT_MS
$guard     = [int]$env:ARCADIA_AGENT_GUARD_MS
$minHeight = [int]$env:ARCADIA_AGENT_MIN_HEIGHT

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

  # Steam's install wizard opens too short to reach its own Install button
  # when started from a URI. Growing it here is the fix, but never past the
  # work area: a dialog taller than the screen would trade one unreachable
  # button for another.
  $targetHeight = [Math]::Max($height, $minHeight)
  if ($null -ne $work) {
    $targetHeight = [Math]::Min($targetHeight, $work.Bottom - $work.Top)
  }
  $resize = $targetHeight -ne $height

  $x = [int]($target.x + ($target.width - $width) / 2)
  $y = [int]($target.y + ($target.height - $targetHeight) / 2)

  # Clamped into the work area so a dialog larger than Arcadia, or an
  # Arcadia half off-screen, cannot push it under the taskbar or past the
  # edge of the monitor.
  if ($null -ne $work) {
    $x = [Math]::Max($work.Left, [Math]::Min($x, $work.Right - $width))
    $y = [Math]::Max($work.Top, [Math]::Min($y, $work.Bottom - $targetHeight))
  }

  # SWP_NOSIZE only comes off when the height is actually growing. Width is
  # never part of that: only the too-short dimension gets fixed.
  if ($resize) {
    $moved = [U]::SetWindowPos($window, $HWND_TOP, $x, $y, $width, $targetHeight, $SWP_SHOWWINDOW)
  } else {
    $moved = [U]::SetWindowPos($window, $HWND_TOP, $x, $y, 0, 0, ($SWP_NOSIZE -bor $SWP_SHOWWINDOW))
  }

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

# Demotes every qualifying store window except one, unconditionally —
# including a window that was already open before the launch. A pre-existing
# Steam client is not a "new" window, so the novelty filter in
# Get-NewStoreWindows never sees it, yet Steam raises that same window the
# moment it handles the install URI. This is what pushes it back down.
function Set-BehindArcadia($exclude) {
  # Nothing to sit behind without a real owner window. Passing IntPtr.Zero
  # to SetWindowPos means HWND_TOP, which would raise these windows instead
  # of lowering them — the exact opposite of the intent.
  if ($owner -eq [IntPtr]::Zero) { return }

  $ids = Get-StorePids
  foreach ($window in [U]::TopLevel()) {
    if ($window -eq $exclude) { continue }
    if (-not [U]::IsWindowVisible($window)) { continue }
    if (-not $ids.ContainsKey([U]::Pid($window))) { continue }
    if (([U]::GetWindowLongValue($window, -20) -band 0x00000080) -ne 0) { continue }

    $rect = New-Object RECT
    if (-not [U]::GetWindowRect($window, [ref]$rect)) { continue }
    if (($rect.Right - $rect.Left) -lt 200) { continue }
    if (($rect.Bottom - $rect.Top) -lt 150) { continue }

    [void][U]::SetWindowPos($window, $owner, 0, 0, 0, 0, ($SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_NOACTIVATE))
  }
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

# Not a fixed pause: Steam raises its client again the moment the user is
# done with the wizard, so the demotion has to last as long as the wizard
# does. Stopping when Arcadia itself is gone keeps this process from
# outliving the app that started it.
$guardEnd = [DateTime]::UtcNow.AddMilliseconds($guard)
while ([DateTime]::UtcNow -lt $guardEnd -and [U]::IsWindow($wizard)) {
  if ($owner -ne [IntPtr]::Zero -and -not [U]::IsWindow($owner)) { break }
  Set-BehindArcadia $wizard
  Start-Sleep -Milliseconds 250
}

# Steam focuses its own client when the wizard closes, which drops the user
# out of Arcadia — the one thing this feature exists to prevent. Raising by
# the topmost bounce works without owning the foreground lock; the
# SetForegroundWindow attempt on top of it is best effort and its failure
# costs nothing. Repeated a few times because Steam does not always raise
# its client immediately.
if ($owner -ne [IntPtr]::Zero -and [U]::IsWindow($owner) -and -not [U]::IsWindow($wizard)) {
  $flags = ($SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_NOACTIVATE)
  for ($i = 0; $i -lt 4; $i++) {
    Set-BehindArcadia ([IntPtr]::Zero)
    [void][U]::SetWindowPos($owner, $HWND_TOPMOST, 0, 0, 0, 0, $flags)
    [void][U]::SetWindowPos($owner, $HWND_NOTOPMOST, 0, 0, 0, 0, $flags)
    [void][U]::SetForegroundWindow($owner)
    Start-Sleep -Milliseconds 200
  }
}

Emit @{ event = 'done' }
`
