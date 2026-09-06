# Shrovetide on iPhone (Capacitor iOS)

The Vite + Phaser web build is unchanged. Touch already lives in `client/touch.ts`
(the same pads Tom uses in Chrome on iPhone). This repo adds a **native iOS
shell** so that build can be installed as an app.

Android is out of scope. `npx cap add android` is possible later if you want it;
it is not wired here.

**Building an IPA / running on a device requires a Mac with Xcode.** Linux and
this Cloud Agent can generate the `ios/` project and sync web assets, but they
cannot compile or sign the app.

App Store submission is **later** — this doc is “open in Xcode and run.”

## What you need (Mac)

- macOS with **Xcode 26 or newer** (Capacitor 8 requirement)
- Xcode Command Line Tools (`xcode-select --install` if prompted)
- An Apple ID (free is enough for your own iPhone; a paid Developer Program
  account is only required for App Store / TestFlight)
- Node 20+ (same as the web game)

You do **not** need CocoaPods. This project uses Swift Package Manager.

## First run on a simulator

From the repo root:

```bash
npm install
npm run cap:ios
```

That builds the web bundle (`dist/`), copies it into the Xcode project
(`npx cap sync ios`), and opens `ios/App/App.xcodeproj` in Xcode.

If Xcode is already open, you can refresh web assets after a game change with:

```bash
npm run cap:sync
```

Then press Run in Xcode again (no need to re-add the iOS platform).

In Xcode:

1. Select the **App** target (left sidebar).
2. At the top, pick an **iPhone simulator** (landscape game; iPhone 16 / 16 Pro
   is fine).
3. Press the Play button (⌘R).
4. Rotate the simulator to landscape if it boots portrait for a frame — the
   project is locked to landscape left/right.

The first SPM resolve (“CapApp-SPM” / `capacitor-swift-pm`) may take a minute
and needs network.

## Run on a physical iPhone

1. Plug the phone in (or enable wireless debugging in Xcode).
2. Unlock it and tap **Trust** if asked.
3. In Xcode, select the **App** target → **Signing & Capabilities**.
4. Tick **Automatically manage signing**.
5. Choose your **Team** (your Apple ID). Xcode will create a free development
   profile for `app.shrovetide.game`.
6. If the bundle ID is already taken on that team, change it only in Xcode
   *and* in `capacitor.config.ts` (`appId`) so they stay in sync.
7. Select your device in the scheme dropdown and press Play.
8. On the phone: Settings → Privacy & Security → Developer Mode (iOS 16+)
   if prompted; then trust the developer certificate under
   Settings → General → VPN & Device Management.

The game uses the existing on-screen stick / Kick / Sprint / Goal pads. No
separate “iPhone controls” rewrite.

## After you change the web game

```bash
npm run cap:sync
```

Then Run in Xcode. Do **not** delete `ios/` and re-run `npx cap add ios`
unless the native project is broken — that wipes any Xcode signing/icon
tweaks.

## Icons and splash

Xcode ships Capacitor’s default icon and splash (`ios/App/App/Assets.xcassets`).
Replace **AppIcon** with `public/icon-512.png` (and the existing
`apple-touch-icon.png`) when you care about the home-screen look. Not required
to play.

## IPA / App Store (later)

- **Archive → IPA** is a Mac/Xcode step: Product → Archive, then Organizer →
  Distribute App. This environment cannot produce an IPA.
- App Store / TestFlight needs an Apple Developer Program membership, screenshots,
  privacy answers, and a review pass. None of that is set up here.
- You may later need `ITSAppUsesNonExemptEncryption` = `NO` in Info.plist if
  the game does not use custom crypto (HTTPS only). Skip until submission.

## Safe area / notch

`index.html` uses `viewport-fit=cover` and `env(safe-area-inset-*, 0px)` so
HUD and pads sit inside the notch and home indicator on a native WKWebView.
Desktop browsers resolve those env() values to `0px`, so the Vite desktop
layout is unchanged.

## Scripts

| Script | What it does |
|---|---|
| `npm run build` | Typecheck + Vite → `dist/` |
| `npm run cap:sync` | `build` then `npx cap sync ios` |
| `npm run cap:ios` | `cap:sync` then `npx cap open ios` (Mac only) |
