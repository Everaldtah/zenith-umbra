"""Inline the screenplay into a Kaggle stage: python prepare.py cinekey|cineanim -> assetgen/<stage>/<stage>.py"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
stage = sys.argv[1]
d = os.path.join(HERE, '..', 'assetgen', stage)
script = open(os.path.join(HERE, 'script.py'), encoding='utf-8').read().split('\nif __name__ ==')[0]
tpl = open(os.path.join(d, 'template.py'), encoding='utf-8').read()
open(os.path.join(d, f'{stage}.py'), 'w', encoding='utf-8').write(script + '\n' + tpl)
print('wrote', stage)
