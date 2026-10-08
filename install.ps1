# Installs the standalone midnight-cast binary from a GitHub release, after checking its SHA-256
# against the release's SHA256SUMS. It needs no Node.js.
#
#   irm https://github.com/Kanasjnr/midnight-cast/releases/latest/download/install.ps1 | iex
#
# MIDNIGHT_CAST_VERSION=0.2.0 installs that release instead of the latest.
# MIDNIGHT_CAST_INSTALL_DIR picks the directory (default %LOCALAPPDATA%\Programs\midnight-cast).
# MIDNIGHT_CAST_DOWNLOAD_URL replaces the release download URL, for a mirror.

# A script block of its own: under irm | iex, settings and variables would otherwise stay in the caller's session.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $repo = 'Kanasjnr/midnight-cast'
  $version = if ($env:MIDNIGHT_CAST_VERSION) { $env:MIDNIGHT_CAST_VERSION } else { 'latest' }
  $defaultDir = Join-Path $env:LOCALAPPDATA 'Programs\midnight-cast'
  $dir = if ($env:MIDNIGHT_CAST_INSTALL_DIR) { $env:MIDNIGHT_CAST_INSTALL_DIR } else { $defaultDir }

  # Windows on Arm runs the x64 binary under emulation.
  $archive = 'midnight-cast-windows-x64.zip'
  if ($env:MIDNIGHT_CAST_DOWNLOAD_URL) {
    $base = $env:MIDNIGHT_CAST_DOWNLOAD_URL
  } elseif ($version -eq 'latest') {
    $base = "https://github.com/$repo/releases/latest/download"
  } else {
    $base = "https://github.com/$repo/releases/download/v$($version.TrimStart('v'))"
  }

  $tmp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    Write-Host "Downloading $archive from $base"
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$archive" -OutFile (Join-Path $tmp $archive)
    Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile (Join-Path $tmp 'SHA256SUMS')

    $expected = Get-Content (Join-Path $tmp 'SHA256SUMS') |
      ForEach-Object { $parts = $_ -split '\s+'; if ($parts[1] -eq $archive -or $parts[1] -eq "*$archive") { $parts[0] } } |
      Select-Object -First 1
    if (-not $expected) { throw "SHA256SUMS has no entry for $archive" }
    $actual = (Get-FileHash -Algorithm SHA256 -Path (Join-Path $tmp $archive)).Hash.ToLowerInvariant()
    if ($actual -ne $expected.ToLowerInvariant()) {
      throw "$archive doesn't match its checksum (expected $expected, got $actual). Nothing was installed."
    }

    Expand-Archive -Path (Join-Path $tmp $archive) -DestinationPath (Join-Path $tmp 'out')
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Copy-Item -Force (Join-Path $tmp 'out\midnight-cast.exe') (Join-Path $dir 'midnight-cast.exe')
    # The npm package installs an mn alias too; another tool's mn is left alone.
    $mn = Join-Path $dir 'mn.cmd'
    if (-not (Test-Path $mn) -or (Get-Content $mn -Raw) -match 'midnight-cast\.exe') {
      Set-Content -Path $mn -Value "@`"%~dp0midnight-cast.exe`" %*" -Encoding ASCII
    } else {
      Write-Host "Left $mn alone: it isn't midnight-cast's."
    }
  } catch {
    # throw, not exit: under irm | iex, exit would close the caller's PowerShell.
    throw "midnight-cast install: $_"
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }

  $installed = & (Join-Path $dir 'midnight-cast.exe') --version
  Write-Host "Installed midnight-cast $installed to $dir\midnight-cast.exe"

  # Only the default directory is put on the user's PATH; a chosen one is left to you. The raw registry
  # value is read and written, since the Environment API expands %VAR% entries and would save them expanded.
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  try {
    $entries = @(($key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) -split ';') | Where-Object { $_ })
    if ($entries -notcontains $dir) {
      if ($dir -eq $defaultDir) {
        $key.SetValue('Path', (($entries + $dir) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
        # Setting and clearing a variable through the Environment API tells running programs that the environment changed.
        [Environment]::SetEnvironmentVariable('MIDNIGHT_CAST_INSTALL', '1', 'User')
        [Environment]::SetEnvironmentVariable('MIDNIGHT_CAST_INSTALL', [NullString]::Value, 'User')
        Write-Host "Added $dir to your user PATH. Open a new terminal to use midnight-cast."
      } else {
        Write-Host "$dir isn't on your PATH. Add it to use midnight-cast from any directory."
      }
    }
  } finally {
    $key.Close()
  }
}
