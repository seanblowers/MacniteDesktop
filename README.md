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
├── dist/              # web assets bundled into the app
│   ├── index.html
│   ├── styles.css
│   ├── app.js         # frontend logic, talks to Rust via invoke()
│   ├── shared.js      # catalog loading + helpers
│   ├── popular.js     # curated list of popular apps
│   ├── popular-fonts.js
│   ├── logo.svg
│   └── wordmark.svg
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

## Install & update via Homebrew

Macnite ships as a Homebrew cask through the [seanblowers/homebrew-macnite](https://github.com/seanblowers/homebrew-macnite) tap. One-line install:

```sh
brew install --cask seanblowers/macnite/macnite
```

To update later:

```sh
brew upgrade --cask macnite
```

Macnite's own **Updates** tab will list `macnite` once a newer release is published. Run `brew upgrade --cask macnite` from Terminal to apply it — the cask quits the running app to replace it, so the upgrade has to come from outside Macnite.

The cask strips the macOS quarantine attribute on install (`postflight` xattr), so the unsigned DMG opens cleanly on first launch — no Apple Developer ID required.

### Publishing a release

1. Bump `version` in `package.json` and `src-tauri/tauri.conf.json`.
2. Build the DMG:
   ```sh
   npm run build
   # → src-tauri/target/release/bundle/dmg/Macnite_<version>_aarch64.dmg
   ```
3. Create a GitHub release tagged `v<version>` here and attach the DMG.
4. In the [homebrew-macnite](https://github.com/seanblowers/homebrew-macnite) repo, bump `version` and `sha256` in `Casks/macnite.rb`:
   ```sh
   shasum -a 256 src-tauri/target/release/bundle/dmg/Macnite_<version>_aarch64.dmg
   ```
   Commit + push. Existing users get the update on their next `brew upgrade`.

### Optional: signing & notarization

If you later get an Apple Developer ID ($99/year), you can sign + notarize so Macnite shows as a trusted developer in About boxes and right-click → Open prompts. With a `.env` containing:

```
APPLE_ID=you@apple.id
APPLE_PASSWORD=<app-specific password from appleid.apple.com>
APPLE_TEAM_ID=<10-char Team ID>
APPLE_SIGNING_IDENTITY=Developer ID Application: Your Name (TEAMID)
```

…run `npm run release` instead of `npm run build` in step 2. Everything else stays the same — the cask's `postflight` xattr is harmless on a signed bundle.

## Distribution notes

- The app contains no telemetry and makes no network requests other than fetching the public Homebrew catalog from `formulae.brew.sh`.
- The first installed copy survives subsequent upgrades — Homebrew operations run as the user, no privilege escalation, no daemon.

## License

MIT. See [LICENSE](./LICENSE).
