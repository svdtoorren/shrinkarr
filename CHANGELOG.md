# Changelog

## 1.0.2

- A file in a folder Shrinkarr can't write to (a read-only mount, or no permission) is skipped before encoding, instead of failing at the replace step after the whole encode. Such files are not queued, and the Library page warns about read-only root folders. (#6)
- When replacing fails, cleaning up no longer adds a second error to the log, and putting a kept original back can't be cut short. (#6)
- **DTS to E-AC3** (Settings → Encoding, off by default): DTS tracks become E-AC3 (1024 kbit/s for 5.1, 320 kbit/s for stereo; 6.1 and 7.1 are downmixed to 5.1), for TVs and Plex apps that can't play DTS and get it transcoded, often to stereo AAC. Files whose video is already HEVC/AV1 get an audio-only conversion: the video is copied, it takes a minute or two, and the minimum savings don't apply. Track titles keep their language ("7.1 DTS-X English" → "5.1 E-AC3 English"). New Library filter: *With DTS audio*.
- **Audio languages** (Settings → Encoding, off by default): when a file is converted anyway, audio tracks outside the languages to keep (picked from a list, e.g. English and Dutch) are left out, as are tracks with a drop word in the title (e.g. `Commentary`, or `Flemish` for a regional variant with the same language code). A wanted language that would end up without a track keeps its drop-word tracks, then the tracks without a language; a file never loses all its audio. If the default track is left out, the first kept track becomes the default. The verify step checks the languages of the output.
- When no Plex library holds the folder of a replaced file (usually a missing or wrong path in Plex under Settings → Paths), the job message says so and a warning is logged, instead of skipping the Plex scan silently. (#7)
- The path check also shows where Plex sees each root folder, and whether a Plex library holds it. If not, it suggests a path in Plex from a library with the same folder name; the wizard asks before continuing without one. (#8)
- **Start now:** the queue page's "Waiting for the time window" banner has a *Start now* button that ignores the window this once, until the queue is empty. Automatic jobs keep their own window.

## 1.0.1

- **Keep originals** (Settings → Encoding): keep a replaced original for 1–30 days, so a conversion can be undone from the History page. The original is moved (not copied) to a hidden `.shrinkarr-originals` folder in the root folder and deleted when its time is up. Off by default. (#4)
- **Versions:** `install.sh` and `shrinkarr-update` install the newest release by default; `shrinkarr-update v1.0.0` installs a given release and `shrinkarr-update main` the newest, untested state. (#3)
- `pct exec <ctid> -- shrinkarr-update` works: the command is also in `/usr/bin`. (#1)
- `proxmox.sh`: more than one media folder. Pick the sub-folders of a parent folder (or set `MEDIA_PATHS="a|b"`); each is mounted at `/data/<folder name>`, folders with a space or comma in the name too. (#5)
- `proxmox.sh`: a media folder owned by a host id in 100000–165535 (for example a bindfs overlay) now works; the service user gets the matching id inside the container. (#2)

## 1.0.0

First release.
