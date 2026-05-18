# Macnite Desktop

A native macOS app that wraps [Macnite](https://macnite.seanblowers.app) — pick the Mac apps you want, click Install, and Macnite runs Homebrew for you. No Terminal needed.

- Browse 14,000+ apps and tools from the Homebrew catalog
- Install, uninstall, and update with one click
- See everything you've installed via Homebrew in one place
- Live install log so you can see what's happening
- Free, open source, no accounts, no tracking
- Built with [Tauri 2](https://tauri.app/) — Rust core, system WebView frontend, ~10 MB bundle

The web version is still the easiest way to try Macnite (no download, copy/paste a command). The desktop app is for people who'd rather click a button than touch Terminal.

## Requirements

To run the built `.app`:
- macOS 11 or newer
- [Homebrew](https://brew.sh) (Macnite will prompt you if it's missing)

To build from source you also need:
- [Node.js](https://nodejs.org/) 18+ and npm
- [Rust](https://rustup.rs/) (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- Xcode Command Line Tools (`xcode-select --install`)

## Getting started

```sh
git clone <this repo>
cd MacniteDesktop
npm install
npm run icon       # one-time: generate app icons from logo.svg
npm run dev        # opens the app with hot reload of HTML/CSS/JS
```

To produce a distributable `.app` and `.dmg`:

```sh
npm run build
# Output: src-tauri/target/release/bundle/{macos,dmg}/
```

## Project layout

```
.
├── index.html         # main UI
├── styles.css
├── app.js             # frontend logic, talks to Rust via invoke()
├── shared.js          # catalog loading + helpers
├── popular.js         # curated list of popular apps
├── logo.svg
├── wordmark.svg
├── package.json
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── capabilities/default.json
    ├── icons/         # populated by `npm run icon`
    └── src/
        ├── main.rs
        └── lib.rs     # brew install/uninstall/upgrade/list commands
```

The frontend is plain HTML/CSS/ES modules — no bundler. Tauri exposes its JS API on `window.__TAURI__` (via `withGlobalTauri: true` in `tauri.conf.json`), so `app.js` calls Rust commands with `window.__TAURI__.core.invoke('install_packages', …)` and streams output via `window.__TAURI__.event.listen(…)`.

If you open `index.html` directly in a browser (outside the Tauri shell), the catalog still loads but install actions are disabled.

## Rust commands

Defined in `src-tauri/src/lib.rs`:

| Command | What it does |
| --- | --- |
| `brew_installed` | Returns `true` if `brew` is on the system |
| `brew_location` | Returns the resolved brew binary path |
| `list_installed` | `{ casks, formulae }` of installed packages |
| `list_outdated` | Output of `brew outdated --json=v2` |
| `install_packages` | Streams `brew install [--cask] <token>` for each package |
| `uninstall_packages` | Streams `brew uninstall [--cask] <token>` for each |
| `upgrade_packages` | Streams `brew upgrade [--cask] <token>` for each |
| `upgrade_all` | Streams `brew upgrade` |

All streaming commands emit `LogLine { stream, line }` events on the event name the frontend passes in.

## Signing & notarization (release builds)

Macnite ships a drag-and-drop DMG. With an Apple Developer ID the build is signed and notarized so Gatekeeper opens it without warnings on first launch.

1. Make sure your Developer ID Application cert is in the login keychain. Verify with:
   ```sh
   security find-identity -v -p codesigning
   ```
   If empty: Xcode → Settings → Accounts → your Apple ID → Manage Certificates → `+` → "Developer ID Application".

2. Generate an app-specific password at [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords. (Your real Apple password won't work with `notarytool`.)

3. Copy `.env.example` to `.env` and fill in the four values:
   ```sh
   cp .env.example .env
   $EDITOR .env
   ```
   `.env` is git-ignored.

4. Build:
   ```sh
   npm run release
   ```
   This sources `.env`, signs the `.app`, builds the DMG, and submits it to Apple for notarization. Notarization usually finishes in 1–3 minutes; you'll see live status in the terminal.

Output: `src-tauri/target/release/bundle/dmg/Macnite_<version>_aarch64.dmg`. Upload that to a GitHub release; users get a clean drag-to-Applications install with no Gatekeeper prompts.

For unsigned dev builds (faster, no notarization), use `npm run build` instead.

## Distribution notes

- The app contains no telemetry and makes no network requests other than fetching the public Homebrew catalog from `formulae.brew.sh`.
- The first installed copy survives subsequent upgrades — Homebrew operations run as the user, no privilege escalation, no daemon.

## License

MIT. See [LICENSE](./LICENSE).
