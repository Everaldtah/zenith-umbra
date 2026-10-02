"""Copy the Kevin Iglesias FREE clips named in kevin_map.json out of the unzipped packs into one folder, each file named
after its clip (several packs share stems like HumanM@Death01), for anim_pack.py --folder.
usage: python stage_kevin.py <unzipped packs root: one folder per pack, named as in kevin_map.json> <stage dir>"""
import glob, json, os, shutil, sys

root, stage = sys.argv[1], sys.argv[2]
os.makedirs(stage, exist_ok=True)
m = {k: v for k, v in json.load(open(os.path.join(os.path.dirname(__file__), 'kevin_map.json'), encoding='utf-8')).items() if not k.startswith('_')}
for key, name in m.items():
    pack, stem = key.split('/', 1)
    hits = [f for f in glob.glob(os.path.join(root, pack, '**', stem + '.fbx'), recursive=True) if '[RM]' not in f]
    if not hits: print('MISSING', key); continue
    shutil.copy(hits[0], os.path.join(stage, name + '.fbx'))
print(len(os.listdir(stage)), 'clips staged in', stage)
