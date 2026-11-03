#!/usr/bin/env python3
"""Génère tests/cam.y4m : fausse caméra pour Chromium (avion loin, proche avec C-FJEP, flou).
Usage : python3 tests/make_video.py   (nécessite Pillow et ffmpeg, ou : pip install Pillow imageio-ffmpeg)"""
import os, shutil, subprocess, tempfile
from PIL import ImageDraw, ImageFilter, ImageFont
from plane import draw

FONTS = ['/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', 'C:/Windows/Fonts/arialbd.ttf',
         '/System/Library/Fonts/Supplemental/Arial Bold.ttf']

def ffmpeg():
    """ffmpeg du système, sinon celui de « pip install imageio-ffmpeg » (pratique sous Windows)."""
    exe = shutil.which('ffmpeg')
    if exe:
        return exe
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()

def load_font(size):
    for f in FONTS:
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()

def regplane(L, blur=0):
    im = draw(L=L); d = ImageDraw.Draw(im); s = L / 900
    d.rectangle([640 - 330 * s, 360 - 30 * s, 640 - 130 * s, 360 + 6 * s], fill=(235, 238, 242))
    font = load_font(max(8, int(34 * s)))
    d.text((640 - 320 * s, 360 - 28 * s), 'C-FJEP', fill=(25, 25, 30), font=font)
    return im.filter(ImageFilter.GaussianBlur(blur)) if blur else im

here = os.path.dirname(os.path.abspath(__file__))
tmp = tempfile.mkdtemp()
n = 0
for L, blur in [(110, 0), (800, 0), (800, 8)]:   # 3 s chacun à 10 i/s
    im = regplane(L, blur)
    for _ in range(30):
        im.save(f'{tmp}/f{n:04d}.png'); n += 1
subprocess.run([ffmpeg(),'-y', '-loglevel', 'error', '-framerate', '10', '-i', f'{tmp}/f%04d.png',
                '-pix_fmt', 'yuv420p', os.path.join(here, 'cam.y4m')], check=True)
shutil.rmtree(tmp)
print('tests/cam.y4m prêt')
