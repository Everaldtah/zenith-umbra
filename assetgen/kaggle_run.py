#!/usr/bin/env python3
"""Push an assetgen stage to Kaggle as a headless GPU script kernel, stream ntfy progress, download outputs.

    python kaggle_run.py concepts [--env KEY=VAL ...] [--sources everaldtah/zu-assetgen-concepts]
    python kaggle_run.py trellis  --sources everaldtah/zu-assetgen-concepts
"""
import argparse, json, subprocess, sys, time, urllib.request, secrets, shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
USER = "everaldtah"


def kaggle(*a):
    return subprocess.run([sys.executable, "-m", "kaggle", *a], capture_output=True, text=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stage")
    ap.add_argument("--env", nargs="*", default=[])
    ap.add_argument("--sources", nargs="*", default=[])
    ap.add_argument("--datasets", nargs="*", default=[])
    ap.add_argument("--no-wait", action="store_true")
    ap.add_argument("--tag", default="")
    ap.add_argument("--tpu", action="store_true", help="run on a TPU v5e-8 (separate quota from the GPUs)")
    a = ap.parse_args()
    name = a.stage + a.tag
    topic = f"zu-{name}-{secrets.token_hex(4)}"
    build = HERE / "build" / name
    shutil.rmtree(build, ignore_errors=True); build.mkdir(parents=True)
    env = {"NTFY_TOPIC": topic, **dict(kv.split("=", 1) for kv in a.env)}
    head = "import os\n" + "".join(f"os.environ[{k!r}] = {v!r}\n" for k, v in env.items())
    body = (HERE / "assets.py").read_text(encoding="utf-8") + "\n\n" + (HERE / a.stage / f"{a.stage}.py").read_text(encoding="utf-8")
    (build / "main.py").write_text(head + body, encoding="utf-8")
    meta = {"id": f"{USER}/zu-assetgen-{name}", "title": f"zu-assetgen-{name}", "code_file": "main.py", "language": "python",
            "kernel_type": "script", "is_private": True, "enable_gpu": not a.tpu, "enable_tpu": a.tpu, "enable_internet": True, **({} if a.tpu else {"machine_shape": "NvidiaTeslaT4"}),
            "dataset_sources": a.datasets, "competition_sources": [], "kernel_sources": a.sources}
    (build / "kernel-metadata.json").write_text(json.dumps(meta), encoding="utf-8")
    r = kaggle("kernels", "push", "-p", str(build))
    print(r.stdout.strip(), r.stderr.strip())
    print("ntfy topic:", topic)
    (HERE / "build" / f"{name}.topic").write_text(topic)
    if not a.no_wait:
        watch(name, topic)


def watch(stage, topic):
    seen, since = set(), "all"
    slug = f"{USER}/zu-assetgen-{stage}"
    while True:
        try:
            with urllib.request.urlopen(f"https://ntfy.sh/{topic}/json?poll=1&since={since}", timeout=20) as r:
                for line in r.read().decode().splitlines():
                    e = json.loads(line)
                    if e.get("event") != "message" or e["id"] in seen: continue
                    seen.add(e["id"]); print(time.strftime("[%H:%M:%S]"), e.get("message", "")[:1500], flush=True)
        except Exception as ex:
            print("poll error", ex)
        st = kaggle("kernels", "status", slug).stdout
        if any(s in st for s in ("COMPLETE", "ERROR", "CANCEL")):
            print(st.strip())
            out = HERE / "out" / stage
            out.mkdir(parents=True, exist_ok=True)
            print(kaggle("kernels", "output", slug, "-p", str(out)).stdout[-400:])
            return
        time.sleep(30)


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "watch":
        watch(sys.argv[2], (HERE / "build" / f"{sys.argv[2]}.topic").read_text().strip())
    else:
        main()
