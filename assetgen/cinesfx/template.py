
# ---------------------------------------------------------------- foley: MMAudio video-to-audio on every animated clip
# (the screenplay above is inlined by cinematic/prepare.py). MMAudio watches the clip and generates synced sound effects;
# the shot's motion description is the text prompt, music and speech are pushed away (the score and voices come separately).
import json, os, sys, glob, time, subprocess, traceback, urllib.request, threading

TOPIC = os.environ.get("NTFY_TOPIC", "zu-cinesfx")
OUT = "/kaggle/working/sfx"; os.makedirs(OUT, exist_ok=True)


def publish(phase, **extra):
    print("PHASE", phase, extra, flush=True)
    try:
        body = json.dumps({"topic": TOPIC, "message": json.dumps({"phase": phase, **extra})[:3800]}).encode()
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh", data=body, headers={"Content-Type": "application/json"}), timeout=15).read()
    except Exception as e:
        print("ntfy failed", e)


try:
    publish("boot"); t0 = time.time()
    r = subprocess.run("git clone -q https://github.com/hkchengrex/MMAudio.git /tmp/MMAudio && cd /tmp/MMAudio && "
                       f"{sys.executable} -m pip install -q -e .", shell=True, capture_output=True, text=True)
    publish("installed", ok=r.returncode == 0, tail=(r.stdout + r.stderr)[-600:])
    clips = {os.path.basename(p)[:-4]: p for p in glob.glob("/kaggle/input/**/clips/*.mp4", recursive=True)}
    jobs = [(s["id"], s["motion"]) for _, s in shots() if s["id"] in clips]
    publish("inputs", n=len(jobs))
    done = []

    def worker(g, items):
        for sid, motion in items:
            t = time.time()
            cmd = [sys.executable, "demo.py", "--video", clips[sid], "--prompt", motion + ", sound effects, foley, ambience",
                   "--negative_prompt", "music, singing, speech, voice, talking", "--duration", "8", "--output", f"/tmp/o{g}",
                   "--skip_video_composite", "--full_precision"]
            r = subprocess.run(cmd, cwd="/tmp/MMAudio", capture_output=True, text=True, env={**os.environ, "CUDA_VISIBLE_DEVICES": str(g)})
            got = glob.glob(f"/tmp/o{g}/{sid}.*")
            if got:
                subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", got[0], f"{OUT}/{sid}.wav"])
                done.append(sid); publish("sfx", id=sid, secs=round(time.time() - t), done=len(done), total=len(jobs))
            else:
                publish("sfx-error", id=sid, tail=(r.stdout + r.stderr)[-700:])

    th = [threading.Thread(target=worker, args=(g, jobs[g::2])) for g in range(2)]
    for x in th: x.start()
    for x in th: x.join()
    publish("done", n=len(done), minutes=round((time.time() - t0) / 60, 1))
except Exception:
    publish("error", trace=traceback.format_exc()[-1500:])
