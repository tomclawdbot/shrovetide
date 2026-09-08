# Shrovetide on iPhone (Capacitor iOS)

Shrovetide is wrapped as a native iOS app with [Capacitor](https://capacitorjs.com).
The web build in `dist/` is bundled into an offline WKWebView shell. The sim
(`/sim`) and client (`/client`, including `client/touch.ts`) are unchanged — the
iOS app just hosts the same web bundle.

- **App ID:** `app.shrovetide.game`
- **App name:** Shrovetide
- **Web dir:** `dist/` (Vite build output)
- **Capacitor:** v7 (matches this repo's Node >= 20 engine)

## What's in the repo

- `capacitor.config.ts` — Capacitor config (appId, appName, webDir, iOS insets).
- `ios/` — the generated native Xcode project. Committed so it opens on any Mac.
- npm scripts:
  - `npm run cap:sync` — `npm run build` then `cap sync ios` (rebuild web +
    copy assets + update native deps).
  - `npm run cap:ios` — `cap open ios` (open the workspace in Xcode).

Some paths are intentionally git-ignored by `ios/.gitignore` and regenerated on
your Mac by `cap sync`: `ios/App/App/public/` (the copied web assets),
`ios/App/Pods/`, `ios/capacitor-cordova-ios-plugins/`, and the generated
`capacitor.config.json` / `config.xml`.

## One-time Mac setup

You need a Mac with:

1. **Xcode** (from the App Store) + Command Line Tools:
   ```sh
   xcode-select --install
   ```
2. **CocoaPods**:
   ```sh
   sudo gem install cocoapods
   # or: brew install cocoapods
   ```
3. **Node >= 20** and this repo cloned, then:
   ```sh
   npm install
   ```

## Build & run

From the repo root on the Mac:

```sh
npm run cap:sync      # build web + sync into ios/ (runs pod install here)
npm run cap:ios       # opens ios/App/App.xcworkspace in Xcode
```

In Xcode:

1. Select the **App** target → **Signing & Capabilities**.
2. Set your **Team** (personal Apple ID is fine for on-device testing) and, if
   needed, a unique bundle identifier (default is `app.shrovetide.game`).
3. Pick a simulator (e.g. *iPhone 15 Pro*) or a plugged-in device.
4. Press **Run** (⌘R).

To run purely in the simulator you can also do:

```sh
npm run cap:sync
npx cap run ios
```

## After changing web code

Any time `/sim`, `/client`, or `index.html` change, refresh the native app:

```sh
npm run cap:sync
```

then Run again in Xcode. (`cap sync` = copy new `dist/` + update native deps.)

## Safe area / notch

`index.html` already sets `viewport-fit=cover` and pads the HUD with
`env(safe-area-inset-*)`. `capacitor.config.ts` sets `ios.contentInset: 'never'`
so the WKWebView draws edge-to-edge and the web layer owns the insets. No native
changes needed.

## Release build

1. In Xcode: **Product → Archive**.
2. Distribute via the Organizer (App Store Connect or ad-hoc/TestFlight).
3. Bump `CFBundleShortVersionString` / build number in the target's **General**
   tab (or `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` build settings).
