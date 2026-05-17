# Icons

Tauri expects PNG/ICNS/ICO icons here at build time. To generate them from
`../../logo.svg`, run from the repo root:

```sh
npx @tauri-apps/cli icon ../logo.svg
```

That produces `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`,
and `icon.ico`. `cargo build` will fail until they exist.
