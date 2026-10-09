#!/bin/sh
# Installs the standalone midnight-cast binary from a GitHub release, after checking its SHA-256
# against the release's SHA256SUMS. It needs no Node.js.
#
#   curl -fsSL https://github.com/Kanasjnr/midnight-cast/releases/latest/download/install.sh | sh
#   wget -qO- https://github.com/Kanasjnr/midnight-cast/releases/latest/download/install.sh | sh
#
# MIDNIGHT_CAST_VERSION=0.2.0 installs that release instead of the latest.
# MIDNIGHT_CAST_INSTALL_DIR picks the directory (default ~/.local/bin).
# MIDNIGHT_CAST_DOWNLOAD_URL replaces the release download URL, for a mirror.

set -eu

repo="Kanasjnr/midnight-cast"
version="${MIDNIGHT_CAST_VERSION:-latest}"
dir="${MIDNIGHT_CAST_INSTALL_DIR:-$HOME/.local/bin}"

fail() {
  echo "midnight-cast install: $*" >&2
  exit 1
}

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) fail "there's no binary for $(uname -s). Use install.ps1 on Windows, or npx midnight-cast with Node.js 20 or later." ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) fail "there's no binary for $(uname -m). Use npx midnight-cast with Node.js 20 or later." ;;
esac
# A shell under Rosetta on Apple silicon reports x86_64; the arm64 binary runs natively.
if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
  arch=arm64
fi
libc=""
if [ "$os" = linux ] && { [ -e /etc/alpine-release ] || ldd --version 2>&1 | grep -qi musl; }; then
  libc="-musl"
fi
archive="midnight-cast-$os-$arch$libc.tar.gz"

# The musl build links the C++ runtime, which a bare Alpine image doesn't have.
has_lib() {
  for lib_dir in /usr/lib /lib /usr/local/lib; do
    [ -e "$lib_dir/$1" ] && return 0
  done
  return 1
}
if [ -n "$libc" ] && { ! has_lib libstdc++.so.6 || ! has_lib libgcc_s.so.1; }; then
  fail "midnight-cast needs libstdc++ and libgcc here. On Alpine: apk add libstdc++ libgcc, then run this again."
fi

if [ -n "${MIDNIGHT_CAST_DOWNLOAD_URL:-}" ]; then
  base="$MIDNIGHT_CAST_DOWNLOAD_URL"
elif [ "$version" = latest ]; then
  base="https://github.com/$repo/releases/latest/download"
else
  base="https://github.com/$repo/releases/download/v${version#v}"
fi

if command -v curl >/dev/null 2>&1; then
  download() { curl -fsSL --retry 3 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  download() { wget -q -O "$2" "$1"; }
else
  fail "it needs curl or wget to download the binary."
fi
if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
else
  fail "it needs sha256sum or shasum to check the download."
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading $archive from $base"
download "$base/$archive" "$tmp/$archive" || fail "couldn't download $base/$archive"
download "$base/SHA256SUMS" "$tmp/SHA256SUMS" || fail "couldn't download $base/SHA256SUMS"
expected="$(awk -v name="$archive" '$2 == name || $2 == "*" name {print $1}' "$tmp/SHA256SUMS")"
[ -n "$expected" ] || fail "SHA256SUMS has no entry for $archive"
actual="$(sha256 "$tmp/$archive")"
[ "$actual" = "$expected" ] || fail "$archive doesn't match its checksum (expected $expected, got $actual). Nothing was installed."

tar -xzf "$tmp/$archive" -C "$tmp" midnight-cast
mkdir -p "$dir"
mv -f "$tmp/midnight-cast" "$dir/midnight-cast"
chmod 755 "$dir/midnight-cast"
# The npm package installs an mn alias too; another tool's mn is left alone.
if [ ! -e "$dir/mn" ] || [ "$(readlink "$dir/mn" 2>/dev/null || true)" = midnight-cast ]; then
  ln -sf midnight-cast "$dir/mn"
else
  echo "Left $dir/mn alone: it isn't midnight-cast's."
fi

echo "Installed midnight-cast $("$dir/midnight-cast" --version) to $dir/midnight-cast"
case ":$PATH:" in
  *":$dir:"*) ;;
  *) echo "$dir isn't on your PATH. Add it, for example: export PATH=\"$dir:\$PATH\"" ;;
esac
