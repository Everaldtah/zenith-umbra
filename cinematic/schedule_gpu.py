"""Fallback: launch the figure batch on Kaggle's T4 x2 once the weekly GPU quota resets (00:00 UTC), unless the TPU or Modal
has already drawn them. Checks the quota through the Kaggle SDK before pushing.
    python schedule_gpu.py            (runs in the background; exits after launching or skipping)
"""
import datetime as dt, json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
W = os.path.join(HERE, "work")
DIRS = [os.path.join(W, d) for d in ("art_local", os.path.join("gpu_out", "art"), os.path.join("tpu_out", "art"))]


def remaining():
    jobs = [j["name"] for j in json.load(open(os.path.join(W, "tpu_in", "jobs.json")))["jobs"] if not j["name"].split("_", 1)[1].startswith("face")]
    return [n for n in jobs if not any(os.path.exists(os.path.join(d, n + ".png")) for d in DIRS)]


def gpu_hours_left():
    from kaggle.api.kaggle_api_extended import KaggleApi
    import io, contextlib
    a = KaggleApi(); a.authenticate()
    q = a.quota_view()
    q = json.loads(str(q)) if not isinstance(q, dict) else q
    g = q["gpuQuota"]; sec = lambda s: float(str(s).rstrip("s").split(".")[0] + "." + str(s).rstrip("s").split(".")[1]) if str(s).count(".") > 1 else float(str(s).rstrip("s"))
    return (sec(g["totalTimeAllowed"]) - sec(g["timeUsed"])) / 3600


def main():
    reset = dt.datetime.now(dt.timezone.utc).replace(hour=0, minute=5, second=0, microsecond=0) + dt.timedelta(days=1)
    print("waiting until", reset.isoformat(), flush=True)
    while dt.datetime.now(dt.timezone.utc) < reset:
        if not remaining(): print("all drawn elsewhere - nothing to do"); return
        time.sleep(600)
    left = remaining()
    if not left: print("all drawn elsewhere - nothing to do"); return
    try: h = gpu_hours_left()
    except Exception as e: h = -1; print("quota check failed", e)
    print(f"{len(left)} drawings left; GPU hours left {h:.1f}", flush=True)
    if 0 <= h < 6: print("not enough GPU quota yet - skipping"); return
    r = subprocess.run([sys.executable, "-u", "kaggle_run.py", "cine2d", "--tag=-gpu", "--datasets", "everaldtah/zu-paint2d", "--no-wait",
                        "--env", "BACKEND=cuda"], cwd=os.path.join(HERE, "..", "assetgen"), capture_output=True, text=True)
    print(r.stdout[-600:], r.stderr[-600:], flush=True)


if __name__ == "__main__":
    main()
