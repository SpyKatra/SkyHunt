#!/usr/bin/env python3
"""Génère tests/cam.y4m : fausse caméra pour Chromium (avion loin, proche avec C-FJEP, flou).
Usage : python3 tests/make_video.py   (nécessite Pillow et ffmpeg)"""
import os, shutil, subprocess, tempfile
from PIL import ImageDraw, ImageFilter, ImageFont
from plane import draw

FONT = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'

def regplane(L, blur=0):
    im = draw(L=L); d = ImageDraw.Draw(im); s = L / 900
    d.rectangle([640 - 330 * s, 360 - 30 * s, 640 - 130 * s, 360 + 6 * s], fill=(235, 238, 242))
    try:
        font = ImageFont.truetype(FONT, max(8, int(34 * s)))
    except OSError:
        font = ImageFont.load_default()
    d.text((640 - 320 * s, 360 - 28 * s), 'C-FJEP', fill=(25, 25, 30), font=font)
    return im.filter(ImageFilter.GaussianBlur(blur)) if blur else im

here = os.path.dirname(os.path.abspath(__file__))
tmp = tempfile.mkdtemp()
n = 0
for L, blur in [(110, 0), (800, 0), (800, 8)]:   # 3 s chacun à 10 i/s
    im = regplane(L, blur)
    for _ in range(30):
        im.save(f'{tmp}/f{n:04d}.png'); n += 1
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '10', '-i', f'{tmp}/f%04d.png',
                '-pix_fmt', 'yuv420p', os.path.join(here, 'cam.y4m')], check=True)
shutil.rmtree(tmp)
print('tests/cam.y4m prêt')
