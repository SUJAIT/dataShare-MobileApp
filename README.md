# DataShare Mobile (Android)

This is the mobile version of DataShare. It works exactly like the PC
version: open the app, it shows a QR code, and any other device (PC or
phone) on the same WiFi can scan that code with its camera to open a web
page and send files - which land directly on this phone.

## Important: this needs a "development build", not Expo Go

This app uses `react-native-tcp-socket` to run a small file-receiving
server directly on the phone. That requires native (non-JavaScript) code,
so it **cannot run inside the regular Expo Go app** from the Play Store.
Instead, you'll build your own custom version of Expo Go (called a
"development build") - a one-time step.

## First-time setup

1. Install [Node.js](https://nodejs.org) (LTS) if not already installed.
2. Install the Expo CLI (one time):
   ```
   npm install -g eas-cli
   ```
3. Inside this project folder:
   ```
   npm install
   ```
4. Create a free Expo account at https://expo.dev if you don't have one,
   then log in from the terminal:
   ```
   npx expo login
   ```

## Building the development build (one-time, ~10-15 minutes)

Run this to build an installable APK using Expo's free cloud build
service (no Android Studio needed):

```
npx eas build --platform android --profile development
```

This will ask a couple of setup questions the first time (accept
defaults). When it finishes, it gives you a **download link** for an
`.apk` file - open that link on your Android phone (or download on PC
and transfer it) and install it, just like any APK.

## Running the app during development

Once the development build (APK) is installed on your phone:

1. Start the dev server on your PC:
   ```
   npx expo start --dev-client
   ```
2. Open the installed app on your phone (it will look for the dev server
   automatically over the same WiFi, or scan the QR code shown in the
   terminal/browser using the app's built-in scanner).
3. The app will load and show the DataShare screen with its own QR code
   for file sharing (this is separate from the Expo dev-server QR code -
   don't confuse the two).

## Building a final, standalone APK (no dev server needed)

Once you're happy with testing, build a production APK that runs on its
own, no PC/dev-server connection required:

```
npx eas build --platform android --profile production
```

This produces a `.apk` (or `.aab` for Play Store) you can share directly
with anyone - they install it like any normal Android app.

## How it works

- `src/server/httpServer.js` - a minimal HTTP server built on raw TCP
  sockets (since phones don't have Node's `http` module like the PC
  version does). It serves the same kind of upload page the PC version
  uses, and saves incoming files to the phone's storage.
- `src/screens/HomeScreen.js` - shows the QR code (encoding this phone's
  local IP + port) and the list of received files.
- Received files are saved under the app's private document directory,
  in a `DataShareReceived/` folder.

## Notes / current limitations (starter version)

- Both devices must be on the same WiFi network (same as the PC version).
- The multipart upload parser is intentionally simple - it works for
  standard browser file uploads, but hasn't been battle-tested with every
  possible file type/size combination yet.
- There's no "Open" or "Save to Gallery" action yet on received files -
  that can be added next (e.g. using `expo-sharing` / `expo-media-library`
  to save photos/videos to the phone's gallery).
