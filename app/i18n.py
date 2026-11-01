"""Server-side texts (job messages, notifications) in English and Dutch.

The web UI translates itself; these are the texts the server stores or sends. They use the
`language` setting.
"""
from . import db

TEXTS = {
    "en": {
        "gone": "The file no longer exists in Sonarr/Radarr",
        "read_only": "The folder is read-only for Shrinkarr ({folder}); the original was kept",
        "no_video": "No video stream found",
        "already": "Already {codec}",
        "bad_subs": "Subtitles in a format MKV does not support: {codecs}",
        "no_space_work": "Not enough free space in {path}",
        "cc_failed": "Closed captions in the video stream could not be extracted; the original was kept",
        "no_hevc": "The output has no HEVC video stream",
        "video_changed": "The video stream of the output differs from the original",
        "audio_not_eac3": "Audio track {n} was not converted to E-AC3",
        "audio_count": "Audio tracks: {got} instead of {want}",
        "sub_count": "Subtitles: {got} instead of {want}",
        "duration": "Duration does not match: {got:.1f}s instead of {want:.1f}s",
        "too_little": "Too little gain ({pct:.0f}%, at least {min}%); the original was kept",
        "changed": "The original changed during the conversion",
        "exists": "{name} already exists",
        "no_space_nas": "Not enough free space on the media storage",
        "copy_incomplete": "The copy on the media storage is incomplete",
        "watched_too_long": "Was being watched in Plex for too long; the original was kept",
        "smaller": "{pct:.0f}% smaller",
        "plus_cc": " (+ closed captions as SRT)",
        "plus_eac3": "; DTS → E-AC3 ({n} track(s))",
        "plus_dropped": "; {n} audio track(s) left out: {list}",
        "audio_langs": "Audio languages of the output: {got} instead of {want}",
        "rescan_failed": "Rescan in {app} failed: {err}",
        "reverted": "Undone: the original is back",
        "kept_gone": "The original is no longer there",
        "plex_failed": "Plex scan failed: {err}",
        "plex_nomatch": "Plex not updated: no Plex library holds {path} (check the Plex path under Settings → Paths)",
        # automatic
        "auto_off": "automatic conversion is off",
        "auto_no_title": "title not found",
        "auto_no_file": "file not found",
        "auto_kind_off": "this kind is off",
        "auto_root_off": "this root folder is excluded",
        "auto_efficient": "already {codec}",
        "auto_not_mkv": "not an MKV (convert by hand)",
        "auto_cutoff": "Sonarr/Radarr is still looking for a better version",
        "auto_queued_already": "already in the queue",
        "auto_tried": "already tried automatically this week",
        "auto_queued": "added to the queue",
        # notifications
        "n_converted": "{n} converted, {saved} saved",
        "n_failed": "{n} failed",
        "n_more": "… and {n} more",
        "n_footer": "{n} left in the queue. Saved in total: {saved}.",
        "n_test_subject": "Shrinkarr: test notification",
        "n_test_body": "Notifications work.",
        "n_open": "Open Shrinkarr",
        "pushover_missing": "Fill in the Pushover API token and user key",
        "smtp_missing": "Fill in the mail server, sender and recipient",
    },
    "nl": {
        "gone": "Bestand bestaat niet meer in Sonarr/Radarr",
        "read_only": "De map is alleen-lezen voor Shrinkarr ({folder}); origineel blijft staan",
        "no_video": "Geen videostroom gevonden",
        "already": "Is al {codec}",
        "bad_subs": "Ondertitels in een formaat dat MKV niet ondersteunt: {codecs}",
        "no_space_work": "Te weinig ruimte in {path}",
        "cc_failed": "Closed captions in de videostroom konden niet worden uitgelezen; origineel blijft staan",
        "no_hevc": "Uitvoer bevat geen HEVC-videostroom",
        "video_changed": "De videostroom van de uitvoer wijkt af van het origineel",
        "audio_not_eac3": "Audiospoor {n} is niet omgezet naar E-AC3",
        "audio_count": "Audiosporen: {got} in plaats van {want}",
        "sub_count": "Ondertitels: {got} in plaats van {want}",
        "duration": "Duur klopt niet: {got:.1f}s in plaats van {want:.1f}s",
        "too_little": "Te weinig winst ({pct:.0f}%, minimaal {min}%); origineel blijft staan",
        "changed": "Het origineel is tijdens het omzetten veranderd",
        "exists": "{name} bestaat al",
        "no_space_nas": "Te weinig ruimte op de media-opslag",
        "copy_incomplete": "Kopie op de media-opslag is onvolledig",
        "watched_too_long": "Werd te lang bekeken in Plex; origineel blijft staan",
        "smaller": "{pct:.0f}% kleiner",
        "plus_cc": " (+ closed captions als SRT)",
        "plus_eac3": "; DTS → E-AC3 ({n} spoor/sporen)",
        "plus_dropped": "; {n} audiospoor/sporen weggelaten: {list}",
        "audio_langs": "Audiotalen van de uitvoer: {got} in plaats van {want}",
        "rescan_failed": "Rescan in {app} mislukt: {err}",
        "reverted": "Ongedaan gemaakt: het origineel staat terug",
        "kept_gone": "Het origineel is er niet meer",
        "plex_failed": "Plex-scan mislukt: {err}",
        "plex_nomatch": "Plex niet bijgewerkt: geen Plex-bibliotheek bevat {path} (controleer het pad in Plex onder Instellingen → Paden)",
        "auto_off": "automatisch omzetten staat uit",
        "auto_no_title": "titel niet gevonden",
        "auto_no_file": "bestand niet gevonden",
        "auto_kind_off": "deze soort staat uit",
        "auto_root_off": "deze hoofdmap is uitgesloten",
        "auto_efficient": "is al {codec}",
        "auto_not_mkv": "geen MKV (handmatig omzetten)",
        "auto_cutoff": "Sonarr/Radarr zoekt nog een betere versie",
        "auto_queued_already": "staat al in de wachtrij",
        "auto_tried": "is deze week al automatisch geprobeerd",
        "auto_queued": "in de wachtrij",
        "n_converted": "{n} omgezet, {saved} bespaard",
        "n_failed": "{n} mislukt",
        "n_more": "… en nog {n}",
        "n_footer": "Nog {n} in de wachtrij. Totaal bespaard: {saved}.",
        "n_test_subject": "Shrinkarr: testmelding",
        "n_test_body": "De meldingen werken.",
        "n_open": "Shrinkarr openen",
        "pushover_missing": "Vul de Pushover API-token en user key in",
        "smtp_missing": "Vul de mailserver, afzender en ontvanger in",
    },
}


def lang() -> str:
    lg = db.get_settings().get("language", "en")
    return lg if lg in TEXTS else "en"


def tr(key: str, **kw) -> str:
    text = TEXTS[lang()].get(key) or TEXTS["en"].get(key, key)
    return text.format(**kw) if kw else text


def fmt_bytes(b: float) -> str:
    sep = "," if lang() == "nl" else "."
    s = f"{b / 1e12:.2f} TB" if b >= 1e12 else f"{b / 1e9:.1f} GB"
    return s.replace(".", sep, 1)
