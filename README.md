# Signal IPTV

A live TV, movies and series player for Android phones, tablets and Android TV. It plays the playlists and logins your provider gives you. Signal IPTV doesn't provide any channels or video content.

## Features

- **Playlists:** Xtream Codes login (server, username, password), M3U/M3U8 links, M3U files, and free public lists. Add as many as you like and switch between them. A `get.php` M3U link is turned into an Xtream login automatically.
- **Live TV:** channel groups, favorites, recently watched, a filter box, and a channel info panel with what's on now, what's next and **catch-up** (replay past programmes when the provider offers it).
- **TV guide (EPG):** the provider's schedule for each channel, an optional full XMLTV guide, and country guides for M3U playlists.
- **Movies and Series:** poster grids with categories and sorting (recently added, A–Z, top rated, newest), detail pages with plot, cast and rating, seasons and episodes, **resume where you left off**, Continue watching, and automatic next episode.
- **Player:** Android's Media3 (ExoPlayer) engine. Plays HLS, MPEG-TS, MP4 and MKV; audio track and subtitle choice; playback speed; ±10 s seek; picture size (fit, stretch, zoom); channel up/down while watching live TV; buffer size and user-agent settings.
- **Android TV:** works with a TV remote (D-pad), appears in the Android TV launcher, and has a TV banner.
- **Search** across channels, movies, series and shows on now; **backup and restore** of playlists and favorites; option to hide adult categories.

## Get the APK

Every change pushed to this repository builds the app on GitHub (**Actions** tab, about 10 minutes).

- Download `SignalIPTV.apk` from **Releases** and install it on your phone or Android TV box.
- Play Protect may warn about an unknown developer, because the app isn't installed from Google Play. Tap **Install anyway**.
- On Android TV, install with a file manager or the "Downloader" app, then find Signal IPTV in the TV's app row.

`SignalIPTV-play.aab` in the same release is the Google Play edition (no extra free-service playlists), for upload in the Play Console.

## Build it yourself

You need Node.js 22, JDK 21 and the Android SDK.

```
npm run build:android    # SignalIPTV.apk
npm run build:play       # SignalIPTV-play.aab (needs KS_B64 and KS_PASS for signing)
```

The web app lives in `www/`; the native player plugin in `native/player/`; Android TV and version settings are applied by `scripts/patch-android.js`.

## Testing without a provider

`tools/mock-xtream/` is a fake Xtream Codes server with a made-up catalog, a TV guide, catch-up and test video:

```
sh tools/mock-xtream/make-media.sh     # once, needs ffmpeg
python3 tools/mock-xtream/server.py 8099
cd www && python3 -m http.server 8098   # then open http://127.0.0.1:8098
```

Log in with server `http://127.0.0.1:8099`, username `demo`, password `demo`.

## Notes

- Only use playlists for content you have the right to watch.
- Logins are stored only on the device and are sent only to the provider's server. See [PRIVACY.md](PRIVACY.md).
