"""Process settings (environment) and the defaults for the settings stored in the database.

Everything a user configures lives in the database and is edited in the web UI (setup wizard and
settings page). The environment only holds where things are stored, plus optional fallbacks for
older installs that were configured through /etc/shrinkarr/config.env.
"""
import os
from pathlib import Path

VERSION = "1.0.2"
REPO = "rvanderend/shrinkarr"


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


WORK_DIR = Path(env("WORK_DIR", "/work"))
DATA_DIR = Path(env("DATA_DIR", "/var/lib/shrinkarr"))
FFMPEG = env("FFMPEG", "ffmpeg")
FFPROBE = env("FFPROBE", "ffprobe")
VAINFO = env("VAINFO", "/usr/lib/jellyfin-ffmpeg/vainfo")
PORT = int(env("PORT", "8080"))

# Quality presets. `q` per encoder; calibrated for hevc_qsv on an Intel UHD 770 with VMAF:
# 1080p WEB H.264 at 9.8 Mbps -> q19 4.8 Mbps (VMAF 95), q21 3.9 (93), q24 ~2.6 (89).
# The other encoders use values that give roughly the same quality.
PRESETS = {
    "high": {"q": {"qsv": 19, "vaapi": 22, "nvenc": 23, "cpu": 21}, "ratio": 0.50, "floor_bpp": 0.060},
    "balanced": {"q": {"qsv": 21, "vaapi": 24, "nvenc": 26, "cpu": 23}, "ratio": 0.40, "floor_bpp": 0.045},
    "max": {"q": {"qsv": 24, "vaapi": 27, "nvenc": 29, "cpu": 26}, "ratio": 0.27, "floor_bpp": 0.030},
}
ENCODERS = ("qsv", "vaapi", "nvenc", "cpu")

# DTS -> E-AC3. ffmpeg's eac3 encoder is simpler than Dolby's, so the bitrates are generous: streaming
# services use 640-768k for 5.1. The encoder goes up to 5.1; more channels (6.1, 7.1) are downmixed to 5.1.
EAC3_BITRATE = {1: 192_000, 2: 320_000, 6: 1_024_000}

DEFAULT_SETTINGS = {
    "language": "en",              # language of server messages and notifications (the UI follows the browser)
    "setup_done": False,
    # Connections
    "sonarr_url": "", "sonarr_api_key": "",
    "radarr_url": "", "radarr_api_key": "",
    "plex_url": "", "plex_token": "",
    # [{"arr": "/media", "local": "/data/media", "plex": ""}]: how paths in Sonarr/Radarr (and Plex) map here
    "path_mappings": [],
    "public_url": "",              # how you open Shrinkarr in the browser (for links in notifications)
    "hook_base_url": "",           # how Sonarr/Radarr reach Shrinkarr (default: http://<LAN IP>:<port>)
    # Encoding
    "encoder": "auto",             # auto | qsv | vaapi | nvenc | cpu
    "gpu_device": "",              # /dev/dri/renderD128 (empty = first one found)
    "preset": "balanced",
    "min_savings": 15,             # percent; less gain = keep the original
    "keep_days": 0,                # keep replaced originals this many days (0 = delete right away)
    "dts_to_eac3": False,          # convert DTS audio to E-AC3, also in files whose video is already efficient
    # Audio languages to keep while converting anyway (ISO 639 codes, e.g. ["eng", "dut"]); empty = keep all
    "audio_keep_languages": [],
    "audio_drop_words": [],        # also drop tracks with one of these words in the title, e.g. "Commentary"
    "window_enabled": False,       # only start new jobs inside a time window
    "window_start": "01:00",
    "window_end": "08:00",
    "paused": False,
    # Automatic conversion after an import in Sonarr/Radarr
    "auto_enabled": False,
    "auto_movies": True,
    "auto_series": True,
    "auto_exclude_roots": [],      # root folders (as Sonarr/Radarr see them) to leave alone
    "auto_preset": "balanced",
    "auto_window_start": "01:00",
    "auto_window_end": "08:00",
    "auto_delay_hours": 1,
    "auto_skip_cutoff": True,
    # Daily summary
    "notify_enabled": False,
    "notify_time": "08:30",
    "notify_method": "email",      # email | pushover
    "smtp_host": "", "smtp_port": 25, "smtp_security": "none",  # none | starttls | ssl
    "smtp_user": "", "smtp_password": "",
    "notify_from": "", "notify_to": "",
    "pushover_token": "", "pushover_user": "", "pushover_device": "", "pushover_priority": 0,
    # Login
    "auth_enabled": False,
    "auth_user": "",
}
SECRET_SETTINGS = ("sonarr_api_key", "radarr_api_key", "plex_token", "smtp_password",
                   "pushover_token", "pushover_user")


def legacy_env() -> dict:
    """Settings of installs configured through config.env (before 1.0)."""
    out = {}
    for key, name in (("sonarr_url", "SONARR_URL"), ("sonarr_api_key", "SONARR_API_KEY"),
                      ("radarr_url", "RADARR_URL"), ("radarr_api_key", "RADARR_API_KEY"),
                      ("plex_url", "PLEX_URL"), ("plex_token", "PLEX_TOKEN"), ("public_url", "PUBLIC_URL"),
                      ("smtp_host", "SMTP_HOST"), ("notify_from", "NOTIFY_FROM"), ("notify_to", "NOTIFY_TO")):
        if env(name):
            out[key] = env(name).rstrip("/") if key.endswith("_url") else env(name)
    if env("SMTP_PORT").isdigit():
        out["smtp_port"] = int(env("SMTP_PORT"))
    if env("ARR_PATH_PREFIX") and env("LOCAL_PATH_PREFIX"):
        out["path_mappings"] = [{"arr": env("ARR_PATH_PREFIX").rstrip("/"),
                                 "local": env("LOCAL_PATH_PREFIX").rstrip("/"), "plex": ""}]
    if env("QSV_DEVICE"):
        out["gpu_device"] = env("QSV_DEVICE")
    return out
