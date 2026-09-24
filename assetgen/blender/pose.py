"""Run MediaPipe pose on a front-view render; print JSON {ok, score, pts:{name:[u,v,vis]}} (u,v in 0..1, v down).
Tries the image as-is and mirrored/contrast-boosted variants, keeps the most confident detection."""
import json, sys, os
import numpy as np
from PIL import Image, ImageOps, ImageEnhance
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

MODEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'models', 'pose_landmarker_heavy.task')
NAMES = {0: 'nose', 7: 'ear_l', 8: 'ear_r', 11: 'shoulder_l', 12: 'shoulder_r', 13: 'elbow_l', 14: 'elbow_r', 15: 'wrist_l', 16: 'wrist_r',
         23: 'hip_l', 24: 'hip_r', 25: 'knee_l', 26: 'knee_r', 27: 'ankle_l', 28: 'ankle_r', 31: 'toe_l', 32: 'toe_r'}

det = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
    base_options=mpt.BaseOptions(model_asset_path=MODEL), running_mode=vision.RunningMode.IMAGE, num_poses=1,
    min_pose_detection_confidence=0.2, min_pose_presence_confidence=0.2))


def run(img: Image.Image):
    arr = np.asarray(img.convert('RGB'))
    r = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=arr))
    if not r.pose_landmarks: return None
    lm = r.pose_landmarks[0]
    pts = {n: [lm[i].x, lm[i].y, lm[i].visibility] for i, n in NAMES.items()}
    score = float(np.mean([p[2] for p in pts.values()]))
    return score, pts


img = Image.open(sys.argv[1])
best = None
for variant in ('plain', 'contrast', 'pad'):
    im = img
    if variant == 'contrast': im = ImageEnhance.Contrast(img.convert('RGB')).enhance(1.6)
    if variant == 'pad':   # smaller figure in a bigger frame sometimes helps the detector
        w, h = img.size; bg = Image.new('RGB', (int(w * 1.5), int(h * 1.5)), (255, 255, 255)); bg.paste(img.convert('RGB'), (w // 4, h // 4)); im = bg
    r = run(im)
    if not r: continue
    score, pts = r
    if variant == 'pad':
        pts = {k: [(p[0] * 1.5 - 0.25), (p[1] * 1.5 - 0.25), p[2]] for k, p in pts.items()}
    if not best or score > best[0]: best = (score, pts, variant)
print(json.dumps({'ok': bool(best), 'score': best[0] if best else 0, 'variant': best[2] if best else None, 'pts': best[1] if best else {}}))
