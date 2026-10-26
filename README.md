# Signal IPTV for Android

A live TV player for M3U playlists, with a TV guide (EPG) showing what's on now and next.

## Get the APK, no coding needed (about 10 minutes)

GitHub builds the app for you for free.

1. Sign in at https://github.com (or create a free account).
2. Create a new repository: click **+** → **New repository**, name it `signal-iptv`, and click **Create repository**.
3. On the new repository page, click **uploading an existing file**. Drag in everything inside this folder, including the hidden `.github` folder, then click **Commit changes**.
   - On a Mac, press Cmd+Shift+. in Finder to show hidden folders. On Windows, turn on View → Show → Hidden items.
   - If dragging the `.github` folder doesn't work, click **Add file → Create new file**, type `.github/workflows/build-android.yml` as the name, paste in that file's contents, and commit.
4. Open the **Actions** tab. A **Build Android APK** run starts automatically and takes about 5–8 minutes. If nothing happens, choose **Build Android APK → Run workflow**.
5. When it finishes, open **Releases** on the repository's main page, either on your phone or on a computer. Download `SignalIPTV.apk`.

## Install on your phone

1. Open the downloaded `SignalIPTV.apk`.
2. Android asks you to allow installs from your browser or file manager. Allow it, then tap **Install**.
3. Play Protect may warn that the app is from an unknown developer. That's expected for an app you built yourself. Tap **Install anyway**.

Every new upload to the repository builds a fresh APK under Releases.

## Using the app

- **Playlists:** pick one from the menu (Pluto TV, Samsung TV Plus, Plex, Free-TV, or iptv-org by category, country or language). You can also paste any M3U link with "Custom M3U link…" or open a .m3u file.
- **TV guide:** Pluto TV, Samsung TV Plus and Plex load their guide automatically. For iptv-org playlists, tap **TV guide** and tick the country guide that matches, such as United States or Canada. Larger guides can take 10–30 seconds to load on a phone.
- **Favorites and Recent** are saved on the device.
- Some free streams are offline or geo-blocked. If one fails, tap **Next**.

## Build with Android Studio instead (optional)

You need Node.js 20+, JDK 21 and Android Studio.

```
npm install
npm run android:init
npx cap sync android
npm run android:open      # opens Android Studio → Run ▶ or Build → Build APK
```

After editing `www/index.html`, run `npm run android:sync` again.

## Notes

- Only add playlists for content you have the right to watch.
- The APK is a debug build signed with a test key. That's fine for your own devices; publishing on Google Play needs a release-signed build.
