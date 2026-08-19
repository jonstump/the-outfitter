# Desktop App — Download and Installation

> Governing: SPEC-0005 REQ "Documented Bypass Instructions for Unsigned Builds", issue #507.

The desktop app is currently published as **unsigned** builds. This means your
operating system will warn that it cannot verify the publisher, because the
artifacts are not code-signed with an Apple Developer ID or Windows
Authenticode certificate. The warnings below are expected, and the steps to
dismiss them are documented per platform.

**Signed builds are planned but not yet available.** When they ship, this page
will carry signed artifacts and the bypass instructions will be removed.

---

## Windows (NSIS installer)

When you run the installer, you may see **"Windows protected your PC"**
(SmartScreen):

1. Click **More info** — this reveals the second button.
2. Click **Run anyway**.

The two steps are in that order because the **Run anyway** button is hidden
until you click **More info** first.

Your browser may also warn about the download itself before you reach the
installer. On managed/corporate machines, SmartScreen may block the installer
entirely with no user-side override — in that case, contact your IT
administrator, or use the self-hosted deployment instead (see the README's
Deployment section).

## macOS (DMG)

When you open the DMG and drag the app to Applications, then try to launch it,
you will see:

> "Backwater Outfitters" cannot be opened because Apple cannot check it for
> malicious software.

To open it:

1. Dismiss the dialog.
2. Open **System Settings** → **Privacy & Security**.
3. Scroll to the "Security" section. You will see a message about
   "Backwater Outfitters" being blocked. Click **Open Anyway**.
4. Confirm in the dialog that appears.

**Do not** Control-click the app and choose **Open** — that override was
removed in macOS 15 (Sequoia) and is currently non-functional advice.

### Lower-friction macOS path: Homebrew

If you use [Homebrew](https://brew.sh), a cask install is a lower-friction
path:

```bash
brew install --cask backwater-outfitters
```

Homebrew removes the quarantine attribute during install, so the Gatekeeper
block above does not apply. *(The cask is not yet published; this line will
be updated when it lands.)*

## Linux (AppImage / deb)

Linux builds are not subject to the same code-signing warnings. Install the
`.deb` package with your package manager, or mark the AppImage executable and
run it:

```bash
chmod +x BackwaterOutfitters-*.AppImage
./BackwaterOutfitters-*.AppImage
```

---

## Self-hosting as an alternative

If the unsigned-build warnings are a blocker, the app remains fully
self-hostable — see the README's **Deployment** section for Docker, PaaS, and
single-VM instructions. The self-hosted target is the same server and client
the desktop app wraps, served from one origin behind your own TLS.
