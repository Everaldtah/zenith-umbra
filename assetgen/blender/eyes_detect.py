"""MediaPipe face landmarks on a front render of a hero's head -> JSON eyelid outlines (u, v in 0..1, v down).
    python eyes_detect.py head.png   ->  {"ok": true, "eyes": [{"inner":[u,v], "outer":[u,v], "top":[u,v], "bottom":[u,v]}, x2]}
Tries the image as-is plus contrast-boosted / upscaled variants (stylised 3D faces need the help)."""
import json, os, sys
import numpy as np
from PIL import Image, ImageEnhance
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

MODEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'models', 'face_landmarker.task')
det = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
    base_options=mpt.BaseOptions(model_asset_path=MODEL), running_mode=vision.RunningMode.IMAGE, num_faces=1,
    min_face_detection_confidence=0.15, min_face_presence_confidence=0.15))
# (inner corner, outer corner, upper lid, lower lid) for each eye in MediaPipe's 468-point mesh
EYES = [(133, 33, 159, 145), (362, 263, 386, 374)]


def run(img):
    r = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(img.convert('RGB'))))
    if not r.face_landmarks: return None
    lm = r.face_landmarks[0]
    return [{k: [lm[i].x, lm[i].y] for k, i in zip(('inner', 'outer', 'top', 'bottom'), e)} for e in EYES]


img = Image.open(sys.argv[1])
out = None
for variant in (img, ImageEnhance.Contrast(img).enhance(1.6), img.resize((img.width * 2, img.height * 2), Image.LANCZOS),
                ImageEnhance.Sharpness(ImageEnhance.Contrast(img).enhance(1.4)).enhance(2.0)):
    out = run(variant)
    if out: break
print(json.dumps({'ok': bool(out), 'eyes': out or []}))
