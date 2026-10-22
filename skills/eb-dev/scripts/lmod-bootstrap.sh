#!/bin/bash
# lmod-bootstrap.sh — lua + luarocks(luaposix/lfs) + tcl + Lmod bootstrap
# (pi skill "eb-dev", deliverable)
#
# Why this exists (LiSC + devenv framing):
#   Nodes/authors must be able to lmod without EESSI and without a distro
#   package — a prefix-led, root-free, version-pinned bootstrap, reproducible
#   from source tarballs with sha256 receipts at both stages.
#
# Usage: lmod-bootstrap.sh <prefix-dir>
#   e.g. /srv/eb-dev/lmod-toolchain          (admin-granted contract; per-user
#   writable after one-time root mkdir+chown of /srv/eb-dev)
#        /tmp/lmod-test-9.4                  (sandbox trial, proven 2026-10-22)
# PROFILE=source (default) | PROFILE=distro (dnf hosts: LiSC Rocky 10, Fedora 44)
# Vars overridable: PROFILE LUA_VER LR_VER TCL_VER BC_VER LMOD_VER LUAPOSIX_VER
#   LFS_VER TCL_CFG_EXTRA TCL_EXTRA_CFLAGS DNF_PKGS LUA_BIN LUA_INC JOBS
#   SOURCES_DIR KEEP_SOURCES
# Pins are versioned facts, not floating: sha256 verified on every run; if a
# mirror serves drifted or poisoned content, the script fails loudly at fetch,
# not silently mid-install. NOTE about codeload: GitHub-generated tarballs are
# not formally guaranteed byte-stable; drift -> loud checksum failure (and a
# re-pin event with upstream-diffed receipts, not a silent pass).

set -euo pipefail

# Profiles:
#   source — lua/luarocks(rocks)/tcl/bc/Lmod ALL from source, root-free,
#     sha-pinned per stage. For sandboxes/audit targets/anywhere without sudo
#     (test1). Proven end-to-end 2026-10-22: Lmod 9.4 + module load smoke.
#   distro — dnf provisioning of lua + posix/lfs lua modules + tcl(+devel) +
#     bc; Lmod still built from source (pinned). Rocks come as RPMs:
#     luarocks NOT needed. Lmod 9.4's real lua gate (configure.ac:1013):
#     5.1..5.5 — the INSTALL file's "Lua 5.1 or 5.2 or 5.3" is stale el6-era
#     doc; luaposix >= 33 required, `term` module optional.
#     Unified package set, verified 2026-10-22 for both targets:
#       Fedora 44:  lua(5.4.8) lua-posix(36.3) lua-filesystem(1.8.0)
#                   tcl tcl-devel(9.0.2) bc(1.08.2)
#       Rocky 10:   lua(5.4.6 AppStream) lua-posix(36.2.1-9.el10_1, EPEL)
#                   lua-filesystem(1.8.0-14.el10_0, EPEL) tcl(8.6.13 BaseOS,
#                   @System) tcl-devel(8.6.13) bc(1.07.1-23.el10)
#                   (Rocky 10 receipts user-verified on login01 2026-10-22)
#     tcl decision: DISTRO tcl here — Lmod accepts any 8.4+ (probes
#     tclsh9.0/tclsh9/tclsh; fastTCLInterp optional). Distro tcl links system
#     zlib and tcl-devel drags pkgconfig(zlib), killing the source-profile
#     bundled-zlib traps wholesale. Source tcl/bc stages stay for
#     zlib-devel-free hosts only.
PROFILE="${PROFILE:-source}"

LUA_VER="${LUA_VER:-5.4.8}"
LR_VER="${LR_VER:-3.9.2}"
TCL_VER="${TCL_VER:-9.0.2}"
BC_VER="${BC_VER:-7.0.3}"
LMOD_VER="${LMOD_VER:-9.4}"
# Rock pins: Lmod configure requires luaposix >= 33 (posix.unistd) and lfs.
LUAPOSIX_VER="${LUAPOSIX_VER:-36.3-1}"
LFS_VER="${LFS_VER:-1.8.0-1}"
# Versions are pins with receipts (sha256 at fetch). Lmod pinned to 9.4 on
# CVE-driven retarget; 9.4.1..9.4.5 exist as later patch points if needed.
LUA_SHA="4f18ddae154e793e46eeab727c59ef1c0c0c2b744e7b94219710d76f530629ae"
LR_SHA="bca6e4ecc02c203e070acdb5f586045d45c078896f6236eb46aa33ccd9b94edb"
TCL_SHA="e074c6a8d9ba2cddf914ba97b6677a552d7a52a3ca102924389a05ccb249b520"
BC_SHA="91eb74caed0ee6655b669711a4f350c25579778694df248e28363318e03c7fc4"
LMOD_SHA="28d56d1615e963da81cf0cbaa47a4d26c551012a4ff13996adb91d4e6eaaf7b3"
LUA_URL="https://www.lua.org/ftp/lua-${LUA_VER}.tar.gz"
LR_URL="https://luarocks.github.io/luarocks/releases/luarocks-${LR_VER}.tar.gz"
TCL_URL="https://sourceforge.net/projects/tcl/files/Tcl/${TCL_VER}/tcl${TCL_VER}-src.tar.gz/download"
# bc-gh (gavinhoward): builds with a bare cc, no flex/bison — unlike GNU bc.
# Release assets are byte-stable uploaded files (not codeload).
BC_URL="https://github.com/gavinhoward/bc/releases/download/${BC_VER}/bc-${BC_VER}.tar.xz"
LMOD_URL="https://github.com/TACC/Lmod/archive/refs/tags/${LMOD_VER}.tar.gz"
# Receipt gap: rock payloads (luaposix/lfs) are fetched by luarocks itself;
# luarocks verifies its own manifest md5, we do not sha256-pin rocks. Version-
# pinned by spec; full-chain sha receipts for rocks = future work.
# zipfs note: tcl's zipfs support is an experimental Tcl feature nobody at
# site uses. Disabled here as policy — but the decisive reason is a tcl 9.0.2
# build-system defect in the default config: zipfs enabled needs zlib-devel,
# yet with no system zlib configure picks the BUNDLED zlib
# (TCL_WITH_INTERNAL_ZLIB), compiles its objects into libtcl, and never puts
# -Icompat/zlib on generic-compile lines, so tclEvent.c (includes "zlib.h"
# for a version string) dies fatal. Seen in both states on this box; zipfs=no
# only narrows the blast radius, the -I top-up below is the actual fix.
# zlib-devel-bearing images (distro profile) can re-enable/drop the top-up.
TCL_CFG_EXTRA="${TCL_CFG_EXTRA:---enable-zipfs=no}"
TCL_EXTRA_CFLAGS="${TCL_EXTRA_CFLAGS:-}"

PREFIX="${1:?usage: lmod-bootstrap.sh <prefix-dir>}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 8)}"
SOURCES_DIR="${SOURCES_DIR:-${PREFIX}/.sources}"
KEEP_SOURCES="${KEEP_SOURCES:-1}"

mkdir -p "${PREFIX}" "${SOURCES_DIR}"

need() { command -v "$1" >/dev/null || { echo "ERROR: need $1 in PATH" >&2; exit 1; }; }
fetch() {
    local url="$1" out="$2" sha="$3"
    if [ ! -f "${out}" ]; then
        echo ">> fetch ${url}"
        curl -fsSL "${url}" -o "${out}"
    fi
    echo ">> verify ${out}"
    echo "${sha}  ${out}" | sha256sum -c - >/dev/null && echo "   sha256 OK"
}

# The dnf package set; same names on Fedora 44 and Rocky 10. Override for a
# differently-organised distro (DNF_PKGS="..." lmod-bootstrap.sh ...).
DNF_PKGS="${DNF_PKGS:-lua lua-posix lua-filesystem tcl tcl-devel bc}"

stage() { echo; echo "===== $1 ====="; }
for t in curl tar sha256sum; do need "$t"; done

case "${PROFILE}" in
    source) for t in gcc make unzip xz; do need "$t"; done ;;
    distro)
        for t in make pkg-config; do need "$t"; done
        stage "distro profile — dnf provisioning: ${DNF_PKGS}"
        need sudo
        sudo dnf install -y ${DNF_PKGS}
        # Assertions with receipts: every Lmod configure prerequisite, checked
        # now so failures blame the package layer, not Lmod.
        lua -e "require 'posix'; require 'posix.unistd'; require 'lfs'; print('lua modules OK (' .. _VERSION .. ')')"
        for t in tclsh bc; do need "$t"; done
        pkg-config --exists tcl  || { echo "ERROR: tcl.pc missing — tcl-devel landed?" >&2; exit 1; }
        pkg-config --exists zlib || { echo "ERROR: zlib.pc missing — zlib-devel landed (via tcl-devel)?" >&2; exit 1; }
        echo "tcl $(pkg-config --modversion tcl), zlib $(pkg-config --modversion zlib) — distro prerequisites OK"
        ;;
    *) echo "ERROR: unknown PROFILE=${PROFILE} (want: source|distro)" >&2; exit 1 ;;
esac

LUA_TARBALL="${SOURCES_DIR}/lua-${LUA_VER}.tar.gz"
LR_TARBALL="${SOURCES_DIR}/luarocks-${LR_VER}.tar.gz"
TCL_TARBALL="${SOURCES_DIR}/tcl${TCL_VER}-src.tar.gz"
BC_TARBALL="${SOURCES_DIR}/bc-${BC_VER}.tar.xz"
LMOD_TARBALL="${SOURCES_DIR}/Lmod-${LMOD_VER}.tar.gz"
if [ "${PROFILE}" = "source" ]; then
    fetch "${LUA_URL}"  "${LUA_TARBALL}"  "${LUA_SHA}"
    fetch "${LR_URL}"   "${LR_TARBALL}"   "${LR_SHA}"
    fetch "${TCL_URL}"  "${TCL_TARBALL}"  "${TCL_SHA}"
    fetch "${BC_URL}"   "${BC_TARBALL}"   "${BC_SHA}"
fi
fetch "${LMOD_URL}" "${LMOD_TARBALL}" "${LMOD_SHA}"

BUILD_DIR="$(mktemp -d /tmp/lmod-bootstrap.XXXXXX)"
cd "${BUILD_DIR}"

if [ "${PROFILE}" = "source" ]; then
# 'linux' target: POSIX + dlopen without readline (io.popen for luarocks,
# loadlib for lfs.so). 'generic' is an ANSI build and starves both.
stage "lua ${LUA_VER}"
tar -xf "${LUA_TARBALL}"
make -C lua-"${LUA_VER}" linux -j"${JOBS}"
make -C lua-"${LUA_VER}" install INSTALL_TOP="${PREFIX}/lua-${LUA_VER}"
"${PREFIX}/lua-${LUA_VER}/bin/lua" -v

stage "luarocks ${LR_VER} — Lmod hard-requires lua modules posix(.unistd, >=33) + lfs"
tar -xf "${LR_TARBALL}"
LR_SRC=$(ls -d luarocks-*/ | head -1)
(
    cd "${LR_SRC}"
    ./configure --prefix="${PREFIX}/luarocks-${LR_VER}" \
        --with-lua-bin="${PREFIX}/lua-${LUA_VER}/bin" \
        --with-lua-include="${PREFIX}/lua-${LUA_VER}/include"
    make -j"${JOBS}"
    make install
)
LUA_PREFIX="${PREFIX}/lua-${LUA_VER}"
LR="${PREFIX}/luarocks-${LR_VER}/bin/luarocks"
"${LR}" --tree="${LUA_PREFIX}" install luaposix "${LUAPOSIX_VER}"
"${LR}" --tree="${LUA_PREFIX}" install luafilesystem "${LFS_VER}"
# Bake module search paths into Lmod: src/lmod.in.lua substitutes configure-
# time package.path/cpath, so export the tree paths BEFORE Lmod configures.
eval "$("${LR}" --tree="${LUA_PREFIX}" path)"
export LUA_PATH LUA_CPATH
"${LUA_PREFIX}/bin/lua" -e "require 'posix'; require 'posix.unistd'; require 'lfs'; print('lua modules OK')"

stage "tcl ${TCL_VER} — Lmod's configure hard-requires tclsh on PATH (fast-TCL-interp)"
tar -xf "${TCL_TARBALL}"
TCL_SRC=$(ls -d tcl${TCL_VER}*/ | head -1)
TCL_SRC_ABS="$(cd "${TCL_SRC}" && pwd)"
(
    cd "${TCL_SRC_ABS}/unix"
    ./configure --prefix="${PREFIX}/tcl-${TCL_VER}" ${TCL_CFG_EXTRA}
    # EXTRA_CFLAGS on the make command line: lands in STUB_CC_SWITCHES ->
    # every compile (tcl core AND bundled Z* zlib objects), unlike a
    # CPPFLAGS env pass which never reaches the bundled-zlib compile rules.
    make -j"${JOBS}" EXTRA_CFLAGS="${TCL_EXTRA_CFLAGS} -I${TCL_SRC_ABS}/compat/zlib"
    make install
)
# tcl 9 installs only a versioned tclsh (tclsh9.0). Lmod 9.4 accepts tclsh9.0;
# older consumers do not. Provide plain `tclsh` for the general case.
if [ ! -e "${PREFIX}/tcl-${TCL_VER}/bin/tclsh" ]; then
    ln -s "$(basename "$(ls "${PREFIX}/tcl-${TCL_VER}/bin"/tclsh[0-9]* | head -1)")" \
        "${PREFIX}/tcl-${TCL_VER}/bin/tclsh"
fi

export PATH="${PREFIX}/tcl-${TCL_VER}/bin:${PATH}"
"${PREFIX}/tcl-${TCL_VER}/bin/tclsh" <<< 'puts "tcl [info patchlevel] OK"'

stage "bc ${BC_VER} — Lmod configure check + runtime (TCL modulefile float arithmetic)"
tar -xf "${BC_TARBALL}"
BC_SRC=$(ls -d bc-*/ | head -1)
(
    cd "${BC_SRC}"
    ./configure.sh --prefix="${PREFIX}/bc-${BC_VER}"
    make -j"${JOBS}"
    make install
)
export PATH="${PREFIX}/bc-${BC_VER}/bin:${PATH}"
"${PREFIX}/bc-${BC_VER}/bin/bc" --version | head -1
fi # PROFILE=source chain

stage "Lmod ${LMOD_VER}"
tar -xf "${LMOD_TARBALL}"
LMOD_SRC=$(ls -d Lmod-*/ | head -1)
# Lmod appends its own lmod/<version> under --prefix; passing the full
# lmod/<ver> path DOUBLES the layout (<p>/lmod/9.4/lmod/9.4) and breaks INIT.
if [ "${PROFILE}" = "distro" ]; then
    # distro tcl(+devel): pkg-config resolves tcl.pc + zlib.pc natively;
    # nothing to force. LUA_BIN/LUA_INC overridable for shim-harness tests.
    LUA_BIN="${LUA_BIN:-/usr/bin}"
    LUA_INC="${LUA_INC:-/usr/include}"
    LMOD_TCL_KV=()
else
    # TCL_INCLUDE/TCL_LIBS explicit: our tcl.pc declares Requires.private:
    # zlib (bundled-zlib build), so Lmod's pkg-config probe errors out and
    # its fallback loop never searches this prefix. -ltcl alone suffices:
    # the zlib objects live inside libtcl9.0.so; rpath covers runtime.
    LUA_BIN="${LUA_BIN:-${PREFIX}/lua-${LUA_VER}/bin}"
    LUA_INC="${LUA_INC:-${PREFIX}/lua-${LUA_VER}/include}"
    LMOD_TCL_KV=( "TCL_INCLUDE=-I${PREFIX}/tcl-${TCL_VER}/include" \
                  "TCL_LIBS=-L${PREFIX}/tcl-${TCL_VER}/lib -Wl,-rpath,${PREFIX}/tcl-${TCL_VER}/lib -ltcl${TCL_VER%.*}" )
fi
./"${LMOD_SRC}"configure \
    --prefix="${PREFIX}" \
    --with-luaBin="${LUA_BIN}" \
    --with-luaInc="${LUA_INC}" \
    "${LMOD_TCL_KV[@]}"
# Lmod's configure writes the Makefile into the CWD it was invoked from
# (BUILD_DIR here), not into the source dir — so make WITHOUT -C.
make -j"${JOBS}"
make install

stage "self-check"
INIT="${PREFIX}/lmod/${LMOD_VER}/init/profile"
[ -f "${INIT}" ] || { echo "ERROR: ${INIT} missing after install" >&2; exit 1; }
bash -c "source '${INIT}'; module --version"

cd /
rm -rf "${BUILD_DIR}"
[ "${KEEP_SOURCES}" = "1" ] && echo "sources kept at ${SOURCES_DIR} (KEEP_SOURCES=0 disables)"

cat <<EOF

Lmod ${LMOD_VER} bootstrapped into ${PREFIX}

Usage:
  source ${INIT}
  module --version

$( [ "${KEEP_SOURCES}" = "1" ] && echo "sha receipts: ${SOURCES_DIR}" )
EOF
