# Install Palot from source

Palot is pre-release software. There are no supported public binary downloads,
automatic updates, RPM packages, or Developer-ID-signed/notarized macOS releases.
Build on the machine where you intend to use it, as your normal user.

## Platform status

| Platform                                 | Available path                                    | Verification status                                                                                                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arch Linux / Omarchy, x86_64             | User-local Nightly; generated local pacman recipe | Linux directory build and bundled-runtime smoke tested on Omarchy 4.0.0.alpha / Wayland. Arch recipe built; clean dependency installation and pacman upgrade/removal not qualified.                                                                              |
| Fedora 43, x86_64                        | User-local Nightly or development                 | Cloud-base + GNOME VM bootstrap, packaged native smoke/UI, same-source replacement and removal tested with SELinux enforcing. Native Wayland click stability remains unresolved; XWayland startup passed. No Workstation-ISO, physical-GPU or RPM qualification. |
| Ubuntu 24.04 LTS, amd64                  | User-local Nightly or development                 | Build, packaged native smoke/UI, update and removal tested on a 24.04.5 cloud-base VM with Ubuntu GNOME/X11 added, using the per-app sandbox profile below. Not a desktop-ISO or physical-GPU qualification; deb/AppImage remain experimental.                   |
| macOS 13 Ventura or later, Apple Silicon | Development; local Nightly build and installer    | Runtime, ad-hoc and locally certificate-signed package smoke, native integration and installer replacement tested on macOS 26.6.2. Signing succeeded in local Terminal, not SSH. Older macOS versions and data migrations remain unqualified.                    |
| macOS 13 or later, Intel                 | Development; local packaging target exists        | npm integrity, architecture, and signed-runtime hashes verified statically. Intel package execution and end-to-end installation are unverified; do not use Rosetta smoke on Apple Silicon.                                                                       |
| Linux ARM64                              | Directory/runtime packaging target exists         | Runtime manifests exist; execution still requires ARM64 hardware verification.                                                                                                                                                                                   |

Windows and musl-based Linux distributions are not covered by this guide. A
working graphical desktop session is required; a headless SSH shell is not enough.
The Linux commands below assume a conventional glibc desktop installation with
working graphics drivers and a user D-Bus session, not a minimal container.

## 1. Platform prerequisites

These commands install build tools plus Electron desktop libraries. They do not
install Palot. Package names are scoped to the releases shown, not all derivatives
or future distro versions. Install Node through Vite+ in the next section rather
than assuming your distro's Node version meets the repository requirement.

### Arch Linux / Omarchy (rolling, x86_64)

Use a fully updated system; Arch does not support partial upgrades. Review the
normal system upgrade before continuing:

```sh
sudo pacman -Syu --needed base-devel git curl unzip ca-certificates python \
  gtk3 nss alsa-lib libxss libxtst libnotify xdg-utils libdrm libxkbcommon mesa
```

`base-devel` supplies the local `makepkg` toolchain. The generated Palot recipe
declares its runtime dependencies; `mesa` supplies the GBM library for Electron.

### Fedora 43 Workstation (x86_64)

```sh
sudo dnf install git unzip ca-certificates tar gcc gcc-c++ make python3 \
  pkgconf-pkg-config gtk3 nss alsa-lib libXScrnSaver libXtst libnotify \
  xdg-utils libdrm libxkbcommon mesa-libgbm
```

The `curl` command must also be present. Fedora's preinstalled `curl-minimal` is
sufficient for the HTTPS downloads below; if neither curl variant is installed,
install `curl-minimal` with DNF. Do not replace an existing curl package just for
Palot. These are ordinary RPM-based Workstation instructions, not Silverblue or
another image-based Fedora setup.

The commands were exercised on Fedora 43 Cloud Base with GNOME added, not a clean
Workstation ISO. In that software-rendered VM, native Wayland presentation was
unreliable; the documented `palot-nightly --ozone-platform=x11` diagnostic
fallback completed first-run startup through XWayland. This is not evidence that
all Fedora Wayland desktops are affected, nor a reason to disable the sandbox or
SELinux.

A follow-up found stalled animation-frame delivery, clicks and renderer captures
despite responsive timers and stable DOM geometry. The same Palot package passed
under XWayland, and minimal sandboxed Electron controls passed under Wayland.
The native presentation integration remains unqualified; this has not been
established as a generic VM limitation or a fixed Palot issue.

### Ubuntu 24.04 LTS Desktop (amd64)

```sh
sudo apt update
sudo apt install git curl unzip ca-certificates build-essential python3 pkg-config \
  libgtk-3-0t64 libnss3 libasound2t64 libxss1 libxtst6 libnotify4 \
  xdg-utils libdrm2 libxkbcommon0 libgbm1
```

The `t64` suffixes are intentional for Ubuntu 24.04; do not paste this list into
older Ubuntu releases. The GTK package pulls in its accessibility, X11, and
Wayland dependencies. On Ubuntu's default policy, the user-local app needs the
per-application sandbox setup below after cloning, before its first launch.

### Linux desktop integration

Use your desktop's existing portal backend and notification service. For native
portal dialogs, install/configure `xdg-desktop-portal` and the backend appropriate
to your desktop through your distro; there is no single backend suitable for every
GNOME, KDE, or Hyprland session. These integrations are distinct from build tools.
Palot uses native Wayland automatically in a Wayland session.

### macOS 13 or later

Install Apple's Command Line Tools, finish the installer, then verify the path:

```sh
xcode-select --install
xcode-select -p
git --version
```

If the tools are already installed, skip the install command. Git, curl, archive
utilities, and Apple's `codesign`/`security` tools must be available. Native module
rebuilds also need Python 3 (`python3 --version`); install it from
[python.org](https://www.python.org/downloads/macos/) if missing. The optional local
signing setup needs OpenSSL 3; see the blocked packaging section below. A paid
Apple Developer membership is not needed for development or local self-signing.

## 2. Clone and bootstrap the toolchain

Use a Bash or Zsh terminal. The current pins are Bun `1.4.2` and Vite+ `0.3.1`;
Node.js must be `24` or later. The root [`package.json`](../package.json) is the
source of truth if these change.

```sh
git clone https://github.com/ItsWendell/palot.git
cd palot

curl -fsSL https://bun.com/install | bash -s "bun-v1.4.2"
curl -fsSL https://vite.plus | VP_VERSION=0.3.1 bash
```

These are the official [Bun](https://bun.com/docs/installation) and
[Vite+](https://viteplus.dev/guide/) installer endpoints. They download and execute
code and may update shell setup; review the scripts first if your policy requires
it. Do not use sudo. Follow the installer's shell instructions, open a new terminal,
and return to the cloned `palot` directory.

Vite+ can manage Node and the package manager. With its shell integration enabled:

```sh
vp env install 24
vp env use 24
bun --version
node --version
vp --version
vp install --frozen-lockfile
```

Check that Bun matches the repository pin and Node is at least 24 before installing
dependencies. If your existing runtime manager takes precedence, resolve the PATH
conflict using [Vite+ environment setup](https://viteplus.dev/guide/env), rather
than rewriting the lockfile. A frozen install must succeed without changing it.
Dependency lifecycle scripts and native code are part of this source-build trust
boundary. Do not run a dev supervisor and packaging build in the same checkout at
the same time: both write `apps/desktop/out`.

## 3. Choose an installation mode

Run commands from the repository root unless a block explicitly changes directory.

### Linux: user-local Nightly (recommended)

#### Ubuntu 24.04: allow the application's namespace sandbox

Ubuntu restricts unprivileged user namespaces. Without an application profile,
Electron aborts with a `chrome-sandbox` ownership/mode error. For the default
user-local path, review and install the supplied profile from the repository root:

```sh
cat apps/desktop/resources/linux/palot-nightly.apparmor
sudo install -o root -g root -m 644 apps/desktop/resources/linux/palot-nightly.apparmor \
  /etc/apparmor.d/palot-nightly
sudo apparmor_parser -r /etc/apparmor.d/palot-nightly
```

Review any existing `/etc/apparmor.d/palot-nightly` before replacing it. This
administrator-approved exception allows namespace creation for
`~/.local/share/palot/nightly/palot-nightly` in the home directories covered by
AppArmor's `HOME` tunable. **Trust the code at that user-writable path:** a replaced
executable receives the same allowance. The profile does not confine Palot's
filesystem or network access; it permits Chromium's own sandbox to initialize.
System-wide AppArmor restrictions and Electron sandboxing remain enabled.

If using a custom `XDG_DATA_HOME`, an alternative channel, or development Electron,
this path does not match. Have an administrator review an exact executable-path
profile for that installation; do not broaden it to all home executables. Do not
use `--no-sandbox`, run Palot as root, make a user-writable helper setuid-root, or
disable the system's user-namespace policy. Fedora/Arch do not need this
Ubuntu-specific step. See [Ubuntu's AppArmor guide](https://documentation.ubuntu.com/server/how-to/security/apparmor/).

#### Build and install

From the repository root:

```sh
bun run install:nightly:linux
```

This builds a host-architecture directory package, stages and verifies the exact
OpenCode runtime, closes the previously installed Nightly, replaces it, and
launches the new app. No globally installed OpenCode CLI is needed for packaged
startup. Installation does not itself restart the shared OpenCode service.

Installed files:

If you set `XDG_DATA_HOME`, use a nonempty absolute path; otherwise leave it unset.

- App: `${XDG_DATA_HOME:-$HOME/.local/share}/palot/nightly`
- Previous app build: the sibling `nightly.previous` (replaced on the next install)
- Launcher: `~/.local/bin/palot-nightly`
- Desktop entry: `${XDG_DATA_HOME:-$HOME/.local/share}/applications/dev.palot.desktop.nightly.desktop`
- Launch log: `${XDG_DATA_HOME:-$HOME/.local/share}/palot/nightly-launch.log`

Launch from your desktop menu, or run `~/.local/bin/palot-nightly --show`. Add
`~/.local/bin` to PATH if you want the shorter `palot-nightly` command.

To build and verify without installing or launching:

```sh
bun run package:nightly:linux
bun run package:verify:linux
```

The result is `apps/desktop/release/linux-unpacked` on x64, or
`apps/desktop/release/linux-arm64-unpacked` on ARM64. Fedora and Ubuntu use this
same directory-based installer; do not assume there is a maintained RPM or deb
repository. AppImage/deb entries in the builder configuration are experimental.

### Arch: optional pacman-owned installation

Choose this instead of the user-local install to avoid duplicate menu entries and
launchers:

```sh
bun run package:arch
cd apps/desktop/release/arch-nightly
# Inspect the generated PKGBUILD before installing it.
makepkg -si
```

This generates a checksummed local binary archive and recipe, not an AUR
publication. Run `makepkg` as your normal user; it requests elevation through
pacman when necessary. The package owns `/opt/palot-nightly`, its `/usr/bin`
launcher, and system desktop/icon/license entries. Launch it from the desktop
menu or with `palot-nightly --show`.

### Linux/macOS: development app

Development uses an external OpenCode CLI rather than the packaged runtime. Read
the exact required version from the desktop manifest to avoid stale instructions:

```sh
version="$(bun -p 'require("./apps/desktop/package.json").devDependencies["@opencode/client"]')"
printf 'Required OpenCode: %s\n' "$version"
command -v opencode2
```

If an existing CLI is installed, check `opencode2 --version` and update that same
installation using its package manager. Avoid creating competing installations.
For a fresh Bun-managed installation:

```sh
bun add --global --trust "@opencode/cli@$version"
opencode2 --version
bun run dev:focus
```

Ensure Bun's global executable directory (normally `~/.bun/bin`) is on PATH.
Do not use `vp --global` to install OpenCode: a Vite+ shim can shadow the real CLI.
The CLI, client, protocol, schema, and service must agree exactly; do not use
`latest` or a moving beta tag. Installing a CLI does not restart an already
running service.

`dev:focus` opens the app in the foreground. `dev:visible` opens it without taking
focus; `dev` starts hidden. Stop your own supervisor with Ctrl-C. These modes have
worktree-local Palot state but share OpenCode configuration, auth, and sessions.

### macOS: local self-signing and Nightly installation

The beta19507 arm64 and x64-baseline runtime hashes are aligned and verified.
Apple Silicon ad-hoc package smoke has been tested with isolated data on
macOS 26.6.2. Local-certificate signing, replacement of an existing Nightly, and
isolated smoke of the installed app also passed through local Terminal on that
machine. The macOS 13 floor, Intel execution, and data migrations remain separate checks.
The macOS build generates both Liquid Glass wrapper formats, and package
verification loads their ESM and CommonJS exports before launching the app.

Local-certificate signing is a separate prerequisite. During SSH verification an
existing `Palot Local Development` identity was visible, but `codesign` returned
`errSecInternalComponent` and the keychain reported “User interaction is not
allowed.” A logged-in GUI desktop alone does not establish key access from SSH.
Use an interactive session with the appropriate unlocked login keychain and
approve macOS's normal key-access prompt if required; do not reset the identity,
change key ACLs broadly, or pass a login password in shell arguments to bypass it.
The same existing identity subsequently signed and installed Nightly successfully
from local Terminal. Strict installed-signature verification and isolated runtime,
preload, renderer and Liquid Glass smoke all passed. No keychain reset or broad
access-control changes were needed.

Review the installer’s effects below before choosing the local flow:

```sh
# Once, if you choose to create Palot's local signing identity:
bun run setup:signing:mac
# Build, verify, locally sign, install, and launch:
bun run install:nightly:mac
```

Read [`setup-local-signing.sh`](../apps/desktop/scripts/setup-local-signing.sh)
before running it. It requires OpenSSL 3 features (`req -addext` and
`rsa -traditional`); Apple's bundled LibreSSL may not support them. If you already
use [Homebrew](https://brew.sh/), one way to provide it is:

```sh
brew install openssl@3
PATH="$(brew --prefix openssl@3)/bin:$PATH" bun run setup:signing:mac
```

Understand the three different signing levels:

- **Ad-hoc signing:** `package:nightly:mac` uses an ad-hoc signature for local
  artifacts. This is not a trusted publisher identity or notarization.
- **Local certificate signing:** the setup script creates a ten-year self-signed
  RSA certificate/private key named `Palot Local Development` in the default user
  keychain and trusts it for code signing. It permits `codesign` and `security` to
  use the key and can remove an unusable certificate with the same name before
  recreating it. This changes local trust and can trigger macOS prompts.
- **Apple distribution signing/notarization:** neither of the above is Developer
  ID signing or Apple notarization. Palot does not provide that distribution path.

Creating this certificate is optional for development or ad-hoc packaging, **but
the current `install:nightly:mac` script requires a certificate identity** and
rejects an ad-hoc-only final signature. An existing appropriate local identity can
be selected with `PALOT_LOCAL_SIGNING_IDENTITY`. Do not set it to `-` as a workaround.

The installer targets `/Applications/Palot Nightly.app`, quits only Nightly, moves
the previous bundle to your Trash for recovery, and launches the replacement. It
requires write access to the installation directory; do not run the build as root.
`PALOT_INSTALL_ROOT="$HOME/Applications"` selects a user-owned alternative.
`bun run install:nightly:full:mac` forces a full package refresh; it does not bypass
runtime or signature verification.

If macOS blocks a locally built app, inspect the failure and use Apple's normal
security review UI only if you trust the source. Do not disable Gatekeeper, strip
quarantine attributes, or weaken signature checks. Local trust is not a reason to
present these builds to others as trusted public releases.

## Shared OpenCode service: review before starting or updating

Opening Palot only connects to the registered local service; it does not silently
start, replace, or upgrade it. **Start OpenCode** is an explicit confirmed action
and can recover an unresponsive shared service. Restarting or replacing a version
is a separate confirmed action and can interrupt active work in other clients.
Finish important turns first. Closing Palot leaves that service running.

Packaged apps use a bundled, verified runtime for explicit local startup; they do
not download executable code on first launch. Development uses the exact external
CLI above. Remote/SSH profiles do not silently fall back to local startup. See the
[runtime contract](opencode-runtime.md) for details.

## Updating and uninstalling

There is no automatic source updater. Preserve local edits, stop any supervisor
you own, then update your checkout deliberately (for a clean checkout tracking
upstream, `git pull --ff-only`). Re-read the toolchain pins and platform blockers,
run `vp install --frozen-lockfile`, and repeat your original install command. For
development, re-read the exact CLI version too. Do not restart a shared service
just to update app files.

To uninstall, quit only the Palot instance you are removing:

- **Linux user-local:** remove only the app directory `palot/nightly`, its
  `palot/nightly.previous` backup if no longer needed, the exact desktop entry, and
  `~/.local/bin/palot-nightly` listed above. Confirm the same `XDG_DATA_HOME` used
  at install time. Do not remove the enclosing data directory. If retiring the
  Ubuntu profile and no other installation uses it, unload and remove only that
  profile: `sudo apparmor_parser -R /etc/apparmor.d/palot-nightly`, then
  `sudo rm /etc/apparmor.d/palot-nightly`.
- **Arch package:** use `sudo pacman -R palot-nightly`; pacman removes its owned
  application files. Do not manually delete `/opt` or `/usr` directories.
- **macOS:** move only `Palot Nightly.app` from your chosen installation directory
  to Trash. Preserve the previous bundle until you no longer need recovery. If
  retiring a local signing identity, review it in Keychain Access and remove only
  the certificate/key you created, and only if no other local builds use it.
- **Development:** stop your supervisor. Keep or archive your checkout; it can
  contain local work and development state, not just disposable build output.

These steps intentionally preserve Palot settings, logs, and all OpenCode sessions,
credentials, configuration, and service state. Do not delete broad `~/.config`,
`~/.local/share`, `~/Library`, or OpenCode directories to uninstall the app.

## Troubleshooting and verification

For Linux, `bun run linux:doctor` reports desktop integration and declared versions;
it is not a full dependency installer or a guarantee that packaging works. A
packaged `palot-nightly --diagnostics` adds Electron display/GPU details. For a
Wayland-specific problem, `palot-nightly --ozone-platform=x11` is a diagnostic
fallback when X11/XWayland is available, not a required installation flag.

Report the distro/macOS version, CPU architecture, command and complete error,
`bun --version`, `node --version`, and `opencode2 --version` when applicable. Review
logs for sensitive content before sharing them. See [support](../SUPPORT.md), the
[development loop](agent-development.md), and [desktop testing](desktop-testing.md).
