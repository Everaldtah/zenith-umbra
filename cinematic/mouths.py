"""Mouth positions for the lip-flap keys, measured on the 3D renders (MediaPipe face landmarks are reliable on those, unlike
an anime-face detector on a 3/4 profile). The face drawings share the render's framing, so the point maps straight across:
drawing px = render px * k, k = min(1, 1152 / longest side) (tpu_prep's canvas scale). Needs the system Python (mediapipe).
    python mouths.py   -> work/tpu_in/mouths.json  {name: [cx, cy, half-width, half-height] in drawing px}
"""
import glob, json, os
import mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions

HERE = os.path.dirname(os.path.abspath(__file__))
IN = os.path.join(HERE, 'work', 'in2d')
MODEL = os.path.join(HERE, '..', 'assetgen', 'models', 'face_landmarker.task')
STANDIN = {'brother': 'haruto'}
LIPS = [13, 14, 61, 291, 0, 17]   # inner upper / lower, corners, outer upper / lower


def main():
    det = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(base_options=BaseOptions(model_asset_path=MODEL), num_faces=1))
    out = {}
    names = sorted(os.path.basename(p)[:-4] for p in glob.glob(os.path.join(IN, '*_face.png')))
    for nid, src in STANDIN.items(): names.append(f'{nid}_face')
    for name in names:
        cid = name.split('_')[0]; src = f"{STANDIN.get(cid, cid)}_face"
        img = mp.Image.create_from_file(os.path.join(IN, f'{src}.png'))
        r = det.detect(img)
        if not r.face_landmarks: print('no face', name); continue
        W, H = img.width, img.height; k = min(1.0, 1152 / max(W, H))
        pts = [(r.face_landmarks[0][i].x * W * k, r.face_landmarks[0][i].y * H * k) for i in LIPS]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        out[name] = [round(cx), round(cy), round(max(12, (max(xs) - min(xs)) * 0.9)), round(max(10, (max(ys) - min(ys)) * 1.3))]
        print(name, out[name])
    json.dump(out, open(os.path.join(HERE, 'work', 'tpu_in', 'mouths.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
