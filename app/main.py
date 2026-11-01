"""Shrinkarr: shrink movies and series from Sonarr/Radarr by re-encoding them to HEVC on the GPU."""
import asyncio
import logging
import os
import shutil
import time
from collections import Counter
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import arr, auth, auto, config, db, encoders, gpu, media
from .worker import WORKER, in_window, writable

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("shrinkarr")
STATIC = Path(__file__).parent / "static"


async def _refresh_loop():
    while True:
        await arr.LIB.refresh()
        await asyncio.sleep(15 * 60)


@asynccontextmanager
async def lifespan(_app):
    db.conn()
    auto.hook_token()
    tasks = [asyncio.create_task(_refresh_loop()), asyncio.create_task(WORKER.run()),
             asyncio.create_task(auto.loop()), asyncio.create_task(encoders.detect())]
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="Shrinkarr", version=config.VERSION, lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC), name="static")

PUBLIC_API = ("/api/auth/", "/api/hook/", "/api/health")


@app.middleware("http")
async def require_login(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and not path.startswith(PUBLIC_API) and auth.enabled():
        if not auth.check_cookie(request.cookies.get(auth.COOKIE)):
            return JSONResponse({"detail": "login"}, status_code=401)
    return await call_next(request)


@app.middleware("http")
async def no_stale_assets(request: Request, call_next):
    # ES modules import each other without a version in the URL: always revalidate them.
    resp = await call_next(request)
    if request.url.path.startswith("/static/") and request.url.path.endswith((".js", ".css", ".html")):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.get("/", include_in_schema=False)
async def index():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/api/health", include_in_schema=False)
async def health():
    return {"ok": True, "version": config.VERSION}


def _unmask(value: str, key: str) -> str:
    """A masked secret from the web UI means: use the stored one."""
    return db.get_settings()[key] if value and "•" in value else value


# --- login --------------------------------------------------------------------

class LoginReq(BaseModel):
    user: str
    password: str


@app.get("/api/auth/status")
async def auth_status(request: Request):
    user = auth.check_cookie(request.cookies.get(auth.COOKIE))
    return {"enabled": auth.enabled(), "loggedIn": bool(user) or not auth.enabled(), "user": user}


@app.post("/api/auth/login")
async def auth_login(req: LoginReq, request: Request):
    s = db.get_settings()
    stored = db.get_state("auth_hash") or ""
    if not (req.user.strip() == s["auth_user"] and auth.check_password(req.password, stored)):
        await asyncio.sleep(1.5)
        raise HTTPException(401, "wrong")
    resp = JSONResponse({"ok": True})
    resp.set_cookie(auth.COOKIE, auth.make_cookie(s["auth_user"]), max_age=auth.MAX_AGE, httponly=True,
                    samesite="lax", secure=request.url.scheme == "https")
    return resp


@app.post("/api/auth/logout")
async def auth_logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.COOKIE)
    return resp


class AuthSetReq(BaseModel):
    enabled: bool
    user: str = ""
    password: str = ""


@app.put("/api/auth")
async def auth_set(req: AuthSetReq, request: Request):
    # Only reachable when logged in (or when the login is off): see require_login.
    if req.enabled:
        if not req.user.strip():
            raise HTTPException(400, "user")
        if req.password:
            if len(req.password) < 8:
                raise HTTPException(400, "short")
            auth.set_credentials(req.user, req.password)
        elif not db.get_state("auth_hash"):
            raise HTTPException(400, "password")
        else:
            db.set_settings({"auth_user": req.user.strip()})
    db.set_settings({"auth_enabled": req.enabled})
    resp = JSONResponse({"ok": True, "enabled": auth.enabled()})
    if auth.enabled():
        resp.set_cookie(auth.COOKIE, auth.make_cookie(db.get_settings()["auth_user"]), max_age=auth.MAX_AGE,
                        httponly=True, samesite="lax", secure=request.url.scheme == "https")
    return resp


# --- library --------------------------------------------------------------------

def _preset(p: str | None) -> str:
    return p if p in config.PRESETS else db.get_settings()["preset"]


def _active_jobs() -> dict[tuple, dict]:
    return {(j["kind"], j["file_id"]): j for j in
            db.q("SELECT id, kind, file_id, status, progress, stage FROM jobs WHERE status IN ('queued','running')")}


def _saved_by_item() -> dict[tuple, int]:
    out: Counter = Counter()
    for r in db.q("SELECT kind, arr_id, SUM(size_before - size_after) AS s FROM jobs "
                  "WHERE status='done' GROUP BY kind, arr_id"):
        out[("movie" if r["kind"] == "movie" else "series", r["arr_id"])] = r["s"] or 0
    return out


def _file_view(f: dict, preset: str, model: media.Model, sample, active) -> dict:
    e = media.estimate(f, f["size"], preset, model, sample)
    job = active.get((f["kind"], f["fileId"]))
    return {**f, "estSize": e["size"], "estSeconds": e["seconds"], "convertible": e["convertible"], "job": job,
            "toEac3": e["convertible"] and media.audio_work(f), "dropLangs": _drop_langs(f) if e["convertible"] else []}


def _drop_langs(f: dict) -> list[str]:
    """Languages Sonarr/Radarr report for a file that the language rules would leave out (by code only)."""
    keep = media.audio_rules(db.get_settings())["keep"]
    langs = [media.norm_lang(x) for x in (f.get("audio") or "").split("/") if x.strip()]
    if not keep or not any(x in keep for x in langs):
        return []
    return sorted({x for x in langs if x not in keep and x not in media.UNKNOWN_LANGS})


def _summary(item: dict, preset: str, model: media.Model, active, saved) -> dict:
    sample = db.get_sample(f"{item['kind']}:{item['id']}:{preset}")
    files = [_file_view(f, preset, model, sample, active) for f in item["files"]]
    size = sum(f["size"] for f in files)
    conv = [f for f in files if f["convertible"]]
    codecs: Counter = Counter()
    res: Counter = Counter()
    for f in files:
        codecs[f["codecLabel"]] += f["size"]
        res[f["bucket"]] += f["size"]
    return {
        "key": f"{item['kind']}:{item['id']}", "kind": item["kind"], "id": item["id"],
        "title": item["title"], "sortTitle": item["sortTitle"], "year": item["year"],
        "root": item["root"], "rootLabel": item["rootLabel"],
        "poster": item["images"].get("poster"), "fileCount": len(files),
        "size": size,
        "estSize": sum(f["estSize"] for f in files),
        "estSeconds": sum(f["estSeconds"] for f in conv),
        "convertible": len(conv),
        "codec": codecs.most_common(1)[0][0] if codecs else "",
        "codecs": dict(codecs),
        "resolution": res.most_common(1)[0][0] if res else "",
        "queued": sum(1 for f in files if f["job"]),
        "running": any(f["job"] and f["job"]["status"] == "running" for f in files),
        "saved": saved.get((item["kind"], item["id"]), 0),
        "dts": sum(1 for f in files if f.get("dts")),
        "sampled": bool(sample),
        "_files": files,
    }


async def _model() -> media.Model:
    return media.Model((await encoders.resolve())["encoder"])


@app.get("/api/library")
async def library(preset: str | None = None):
    preset = _preset(preset)
    if not arr.LIB.refreshed:
        await arr.LIB.refresh()
    model, active, saved = await _model(), _active_jobs(), _saved_by_item()
    items = []
    for it in [*arr.LIB.movies.values(), *arr.LIB.series.values()]:
        s = _summary(it, preset, model, active, saved)
        s.pop("_files")
        items.append(s)
    roots = [{**r, "writable": writable(arr.to_local(r["path"]))} for app_ in arr.APPS for r in arr.LIB.roots.get(app_, [])]
    return {"items": items, "preset": preset, "refreshed": arr.LIB.refreshed, "error": arr.LIB.error,
            "learned": model.count, "roots": roots,
            "configured": any(arr.configured(a) for a in arr.APPS)}


@app.get("/api/item/{kind}/{item_id}")
async def item_detail(kind: str, item_id: int, preset: str | None = None):
    preset = _preset(preset)
    it = arr.LIB.item(kind, item_id)
    if not it:
        raise HTTPException(404, "not found")
    s = _summary(it, preset, await _model(), _active_jobs(), _saved_by_item())
    s["files"] = s.pop("_files")
    s.update(overview=it.get("overview"), genres=it.get("genres"), network=it.get("network", ""),
             fanart=it["images"].get("fanart"), preset=preset)
    s["history"] = db.q("SELECT id, subtitle, status, message, size_before, size_after, finished FROM jobs "
                        "WHERE kind=? AND arr_id=? AND status IN ('done','failed','skipped') "
                        "ORDER BY finished DESC LIMIT 50",
                        ("movie" if kind == "movie" else "episode", item_id))
    return s


@app.post("/api/library/refresh")
async def library_refresh():
    await arr.LIB.refresh()
    return {"ok": not arr.LIB.error, "error": arr.LIB.error}


class EstimateReq(BaseModel):
    kind: str
    id: int
    preset: str | None = None


@app.post("/api/estimate")
async def precise_estimate(req: EstimateReq):
    """Test encode of a few fragments for an accurate estimate."""
    preset = _preset(req.preset)
    it = arr.LIB.item(req.kind, req.id)
    if not it:
        raise HTTPException(404, "not found")
    files = [f for f in it["files"] if not f["efficient"] and f["duration"] > 60]
    if not files:
        raise HTTPException(400, "nothing")
    files = sorted(files, key=lambda f: -f["size"])[:2]
    if WORKER.current:
        raise HTTPException(409, "busy")
    enc = await encoders.resolve()
    results = []
    try:
        for f in files:
            results.append(await media.sample(f["path"], preset, enc, segments=3 if len(files) == 1 else 2))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, str(e)) from e
    ratio = sum(r["ratio"] for r in results) / len(results)
    fps = sum(r["fps"] for r in results) / len(results)
    db.set_sample(f"{req.kind}:{req.id}:{preset}", ratio, fps)
    for r in results:
        db.add_observation(preset, r["bucket"], r["codec"], r["ratio"],
                           r["fps"] if r["hw"] or enc["encoder"] == "cpu" else None, "sample", enc["encoder"])
    return await item_detail(req.kind, req.id, preset)


@app.get("/api/cover/{app_name}/{item_id}/{kind}")
async def cover(app_name: str, item_id: int, kind: str):
    if app_name not in arr.APPS or kind not in ("poster", "fanart"):
        raise HTTPException(404)
    path = await arr.cover(app_name, item_id, kind)
    if not path:
        raise HTTPException(404)
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


# --- queue ------------------------------------------------------------------------

class EnqueueItem(BaseModel):
    kind: str          # movie | series
    id: int
    fileIds: list[int] | None = None


class EnqueueReq(BaseModel):
    items: list[EnqueueItem]
    preset: str | None = None


@app.post("/api/jobs")
async def enqueue(req: EnqueueReq):
    preset = _preset(req.preset)
    model = await _model()
    added = read_only = 0
    for ref in req.items:
        it = arr.LIB.item(ref.kind, ref.id)
        if not it:
            continue
        sample = db.get_sample(f"{ref.kind}:{ref.id}:{preset}")
        for f in it["files"]:
            if ref.fileIds is not None and f["fileId"] not in ref.fileIds:
                continue
            if not media.needs_work(f) or db.active_job_for(f["kind"], f["fileId"]):
                continue
            if not writable(Path(f["path"]).parent):
                read_only += 1
                continue
            e = media.estimate(f, f["size"], preset, model, sample)
            title = f"{it['title']} ({it['year']})" if it["kind"] == "movie" and it.get("year") else it["title"]
            db.add_job(kind=f["kind"], arr_id=it["id"], file_id=f["fileId"], title=title,
                       subtitle=f["label"] if f["kind"] == "episode" else f["quality"], path=f["path"],
                       preset=preset, size_before=f["size"], est_size=e["size"], est_seconds=e["seconds"])
            added += 1
    WORKER.wake.set()
    return {"added": added, "readOnly": read_only}


JOB_COLS = ("id, kind, arr_id, file_id, title, subtitle, path, preset, status, stage, progress, fps, speed, eta, "
            "cur_size, size_before, size_after, est_size, est_seconds, message, position, created, started, finished, "
            "source, not_before, kept_path, kept_until")


@app.get("/api/jobs")
async def jobs():
    queue = db.q(f"SELECT {JOB_COLS} FROM jobs WHERE status IN ('running','queued') "
                 "ORDER BY status='running' DESC, position")
    recent = db.q(f"SELECT {JOB_COLS} FROM jobs WHERE status NOT IN ('running','queued') "
                  "ORDER BY finished DESC LIMIT 200")
    tot = db.one("SELECT COUNT(*) AS n, COALESCE(SUM(size_before - size_after), 0) AS saved, "
                 "COALESCE(SUM(size_before), 0) AS before FROM jobs WHERE status='done'")
    failed = db.one("SELECT COUNT(*) AS n FROM jobs WHERE status='failed'")["n"]
    s = db.get_settings()
    return {"state": WORKER.state, "queue": queue, "recent": recent, "totals": {**tot, "failed": failed},
            "paused": s["paused"], "window": f"{s['window_start']}–{s['window_end']}",
            "bypass": bool(db.get_state("window_bypass")) and s["window_enabled"] and not in_window(s),
            "autoWindow": f"{s['auto_window_start']}–{s['auto_window_end']}"}


@app.post("/api/queue/start-now")
async def queue_start_now():
    """Ignore the time window this once: the queue runs until it is empty."""
    db.set_state("window_bypass", True)
    WORKER.wake.set()
    return {"ok": True}


@app.get("/api/jobs/{job_id}")
async def job_detail(job_id: int):
    j = db.one("SELECT * FROM jobs WHERE id=?", (job_id,))
    if not j:
        raise HTTPException(404)
    return j


@app.delete("/api/jobs/{job_id}")
async def job_cancel(job_id: int):
    j = db.one("SELECT status FROM jobs WHERE id=?", (job_id,))
    if not j:
        raise HTTPException(404)
    if j["status"] == "running":
        WORKER.cancel(job_id)
    elif j["status"] == "queued":
        db.update_job(job_id, status="cancelled", stage="cancelled", finished=time.time())
    else:
        db.exec("DELETE FROM jobs WHERE id=?", (job_id,))
    return {"ok": True}


@app.post("/api/jobs/{job_id}/retry")
async def job_retry(job_id: int):
    j = db.one("SELECT * FROM jobs WHERE id=?", (job_id,))
    if not j or j["status"] in ("queued", "running"):
        raise HTTPException(400)
    if db.active_job_for(j["kind"], j["file_id"]):
        raise HTTPException(409, "queued")
    pos = (db.one("SELECT MAX(position) AS p FROM jobs")["p"] or 0) + 1
    db.update_job(job_id, status="queued", stage="", progress=0, message="", log="", position=pos,
                  finished=None, started=None, size_after=None, source="manual", not_before=None)
    WORKER.wake.set()
    return {"ok": True}


@app.post("/api/jobs/{job_id}/undo")
async def job_undo(job_id: int):
    """Puts the kept original back and removes the converted file."""
    from .i18n import tr
    j = db.one("SELECT * FROM jobs WHERE id=?", (job_id,))
    if not j or j["status"] != "done" or not j["kept_path"] or not j["orig_path"]:
        raise HTTPException(400, "cannot undo")
    kept, orig, new = Path(j["kept_path"]), Path(j["orig_path"]), Path(j["path"])
    if not kept.exists():
        db.update_job(job_id, kept_path=None)
        raise HTTPException(410, tr("kept_gone"))
    if orig == new:
        os.replace(kept, orig)
    else:
        os.rename(kept, orig)
        new.unlink(missing_ok=True)
    d = kept.parent  # remove the folders that are now empty, up to .shrinkarr-originals
    while d.name and d != d.parent and not any(d.iterdir()):
        d.rmdir()
        if d.name == ".shrinkarr-originals":
            break
        d = d.parent
    db.update_job(job_id, status="reverted", stage="reverted", message=tr("reverted"), kept_path=None, path=str(orig))
    try:
        await arr.rescan(j["kind"], j["arr_id"])
        await arr.plex_refresh(str(orig))
    except Exception:  # noqa: BLE001
        log.warning("Rescan after undo failed for job %s", job_id)

    async def later():
        await asyncio.sleep(20)
        await arr.LIB.refresh_item("movie" if j["kind"] == "movie" else "series", j["arr_id"])
    asyncio.create_task(later())
    return {"ok": True}


@app.post("/api/jobs/{job_id}/top")
async def job_top(job_id: int):
    pos = (db.one("SELECT MIN(position) AS p FROM jobs WHERE status='queued'")["p"] or 1) - 1
    db.update_job(job_id, position=pos)
    return {"ok": True}


@app.post("/api/jobs/clear")
async def jobs_clear():
    db.exec("DELETE FROM jobs WHERE status IN ('cancelled','skipped','failed')")
    return {"ok": True}


# --- settings ------------------------------------------------------------------------

def _masked(s: dict) -> dict:
    s = dict(s)
    for k in config.SECRET_SETTINGS:
        if s.get(k):
            s[k] = "••••" + s[k][-4:]
    return s


CONNECTION_KEYS = {"sonarr_url", "sonarr_api_key", "radarr_url", "radarr_api_key", "path_mappings"}


@app.get("/api/settings")
async def settings_get():
    return {"settings": _masked(db.get_settings()), "presets": list(config.PRESETS),
            "encoders": list(config.ENCODERS), "version": config.VERSION}


@app.put("/api/settings")
async def settings_put(values: dict):
    before = db.get_settings()
    s = db.set_settings(values)
    if any(before[k] != s[k] for k in CONNECTION_KEYS):
        asyncio.create_task(arr.LIB.refresh())
    if before["plex_url"] != s["plex_url"]:
        arr._plex_sections.clear()
    WORKER.wake.set()
    return {"settings": _masked(s)}


_health: dict = {"t": 0}


@app.get("/api/status")
async def status():
    if time.time() - _health["t"] > 60:
        _health.update(await arr.health(), t=time.time())

    def disk(p):
        try:
            u = shutil.disk_usage(p)
            return {"path": str(p), "total": u.total, "free": u.free}
        except OSError:
            return None
    maps = db.get_settings()["path_mappings"]
    media_disk = disk(maps[0]["local"]) if maps and maps[0].get("local") else None
    enc = await encoders.resolve()
    return {
        **{k: _health.get(k) for k in ("sonarr", "radarr", "plex")},
        "encoder": enc,
        "worker": WORKER.state,
        "library": {"refreshed": arr.LIB.refreshed, "error": arr.LIB.error,
                    "movies": len(arr.LIB.movies), "series": len(arr.LIB.series)},
        "disk": {"media": media_disk, "work": disk(config.WORK_DIR)},
        "learned": len(db.observations(enc["encoder"])),
        "hooks": {"sonarr": db.get_state("hook_sonarr"), "radarr": db.get_state("hook_radarr")},
    }


# --- setup wizard and tests ----------------------------------------------------------------

@app.get("/api/setup")
async def setup_info():
    s = db.get_settings()
    return {"setupDone": s["setup_done"], "version": config.VERSION, "lanUrl": auto.hook_base()}


@app.post("/api/setup/complete")
async def setup_complete():
    db.set_settings({"setup_done": True})
    asyncio.create_task(arr.LIB.refresh())
    WORKER.wake.set()
    return {"ok": True}


class ArrTestReq(BaseModel):
    app: str
    url: str
    api_key: str


@app.post("/api/test/arr")
async def test_arr(req: ArrTestReq):
    if req.app not in arr.APPS:
        raise HTTPException(400)
    return await arr.test_arr(req.app, req.url, _unmask(req.api_key, f"{req.app}_api_key"))


class PlexTestReq(BaseModel):
    url: str
    token: str


@app.post("/api/test/plex")
async def test_plex(req: PlexTestReq):
    return await arr.test_plex(req.url, _unmask(req.token, "plex_token"))


def _suggest_plex(root: str, local: str, library_paths: list[str]) -> dict | None:
    """Suggests a Plex path from a library that ends in the same folder name: /data/tv + /mnt/media/tv -> /data -> /mnt/media."""
    for p in library_paths:
        a, l_, x = Path(root), Path(local), Path(p)
        if x.name != l_.name:
            continue
        while a.name == l_.name == x.name and a.name and min(len(a.parts), len(l_.parts), len(x.parts)) > 2:
            a, l_, x = a.parent, l_.parent, x.parent
        if l_ != x:
            return {"arr": str(a), "local": str(l_), "plex": str(x)}
    return None


def _suggest_local(arr_root: str) -> str | None:
    """Looks for a folder with the same name under the usual mount points (max. 3 levels deep)."""
    name = Path(arr_root).name
    for base in ("/data", "/media", "/mnt"):
        b = Path(base)
        if not b.is_dir():
            continue
        for depth in range(0, 3):
            for d in b.glob("/".join(["*"] * depth + [name])) if depth else [b / name]:
                if d.is_dir():
                    return str(d)
    return None


class PathsReq(BaseModel):
    mappings: list[dict]


@app.post("/api/test/paths")
async def test_paths(req: PathsReq):
    """Checks every root folder of Sonarr/Radarr against the mappings (in Shrinkarr and in Plex), and suggests missing ones."""
    pairs = [(m.get("arr", "").rstrip("/"), m.get("local", "").rstrip("/")) for m in req.mappings
             if m.get("arr") and m.get("local")]
    plex_pairs = [(m["local"].rstrip("/"), (m.get("plex") or m["local"]).rstrip("/")) for m in req.mappings
                  if m.get("arr") and m.get("local")]
    s = db.get_settings()
    libraries = None  # paths of the Plex libraries; None = Plex not set up or not reachable
    if arr.plex_configured(s):
        try:
            libraries = [p for d in await arr.plex_sections() for p in d["paths"]]
        except Exception:  # noqa: BLE001
            pass
    roots = []
    for app_ in arr.APPS:
        if not arr.configured(app_, s):
            continue
        try:
            roots += [(app_, r["path"].rstrip("/")) for r in await arr.api(app_, "GET", "/rootfolder")]
        except Exception:  # noqa: BLE001
            pass
    out = []
    for app_, root in roots:
        local = arr._swap(root, pairs) or root
        exists = os.path.isdir(local)
        row = {"app": app_, "arr": root, "local": local, "exists": exists,
               "writable": exists and os.access(local, os.W_OK), "suggestion": None}
        if not exists:
            found = _suggest_local(root)
            if found:
                # Map the shortest differing prefix: /media/films + /data/video/films -> /media -> /data/video
                a, l_ = Path(root), Path(found)
                while a.name == l_.name and a.name and len(a.parts) > 1 and len(l_.parts) > 1:
                    a, l_ = a.parent, l_.parent
                row["suggestion"] = {"arr": str(a), "local": str(l_)}
        row["plex"] = None
        if libraries is not None and exists:
            in_plex = arr._swap(local, plex_pairs) or local
            ok = arr.in_plex(in_plex, libraries)
            row["plex"] = {"path": in_plex, "ok": ok, "suggestion": None if ok else _suggest_plex(root, local, libraries)}
        out.append(row)
    return {"roots": out}


@app.get("/api/encoders")
async def encoders_list(force: bool = False):
    found = await encoders.detect(force)
    return {"detected": found, "active": await encoders.resolve(), "devices": encoders.render_devices()}


@app.get("/api/gpu")
async def gpu_info():
    enc = await encoders.resolve()
    proc = WORKER.proc.get("proc")
    pid = proc.pid if proc and proc.returncode is None else None
    model = media.Model(enc["encoder"])
    work = db.one("SELECT COUNT(*) AS n, COALESCE(SUM(finished - started), 0) AS secs FROM jobs WHERE status='done'")
    return {"encoder": enc, "static": await gpu.static_info(enc), "live": await gpu.live(enc, pid),
            "encoding": pid is not None,
            "fps": {b: round(model.enc_fps(b)) for b in ("sd", "720p", "1080p", "2160p")},
            "measured": sorted(model.fps), "jobs": work}


@app.post("/api/notify/test")
async def notify_test():
    from .i18n import tr
    res = auto.summary(time.time() - 86400) or (tr("n_test_subject"), tr("n_test_body"))
    try:
        await auto.send(*res)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, str(e)) from e
    return {"ok": True, "subject": res[0]}


# --- webhooks from Sonarr/Radarr ------------------------------------------------------------

@app.get("/api/hooks")
async def hooks_info():
    return {"base": auto.hook_base(), "sonarr": auto.hook_url("sonarr"), "radarr": auto.hook_url("radarr"),
            "last": {"sonarr": db.get_state("hook_sonarr"), "radarr": db.get_state("hook_radarr")}}


@app.post("/api/hooks/install")
async def hooks_install():
    return await auto.install_webhooks()


@app.post("/api/hook/{app_name}")
async def hook(app_name: str, request: Request, token: str = ""):
    if app_name not in arr.APPS or token != auto.hook_token():
        raise HTTPException(403)
    payload = await request.json()
    asyncio.create_task(auto.handle_webhook(app_name, payload))
    return {"ok": True}


# --- version ---------------------------------------------------------------------------------

_latest: dict = {"t": 0, "v": None}


@app.get("/api/version")
async def version():
    if time.time() - _latest["t"] > 6 * 3600:
        _latest["t"] = time.time()
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.get(f"https://api.github.com/repos/{config.REPO}/releases/latest",
                                headers={"Accept": "application/vnd.github+json"})
            _latest["v"] = r.json().get("tag_name", "").lstrip("v") if r.status_code == 200 else None
        except httpx.HTTPError:
            _latest["v"] = None
    latest = _latest["v"]

    def parts(v):
        return tuple(int(x) for x in v.split(".") if x.isdigit())
    newer = bool(latest) and parts(latest) > parts(config.VERSION)
    return {"version": config.VERSION, "latest": latest, "update": newer,
            "url": f"https://github.com/{config.REPO}"}


@app.get("/manifest.webmanifest", include_in_schema=False)
async def manifest():
    return Response(
        '{"name":"Shrinkarr","short_name":"Shrinkarr","start_url":"/","display":"standalone",'
        '"background_color":"#0f1115","theme_color":"#0f1115",'
        '"icons":[{"src":"/static/icon.svg","sizes":"any","type":"image/svg+xml"}]}',
        media_type="application/manifest+json")
