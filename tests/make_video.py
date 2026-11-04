#!/usr/bin/env python3
"""Génère tests/cam.y4m : fausse caméra pour Chromium (avion loin, proche avec C-FJEP, flou,
puis le même avion photographié sur un écran).
Usage : python3 tests/make_video.py   (nécessite Pillow et ffmpeg, ou : pip install Pillow imageio-ffmpeg)"""
import os, shutil, subprocess, tempfile
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
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

def camera(im):
    """Rendu « filmé » : léger flou d'objectif et bruit du capteur. Sans ça, l'image dessinée
    (aplats, bords parfaits) ressemble à un écran pour l'anti-triche (web/screen.js)."""
    im = im.filter(ImageFilter.GaussianBlur(0.8))
    noise = Image.effect_noise(im.size, 3).convert('RGB')   # bruit de luminance, centré sur 128
    return ImageChops.add(im, noise, 1, -128)

def on_screen(im, pitch=3):
    """L'image affichée sur un écran puis filmée de près : chaque pixel de l'écran devient
    3×3 pixels de la caméra (colonnes rouge, verte, bleue et une ligne plus sombre entre les rangées)."""
    w, h = im.size
    small = im.resize((w // pitch, h // pitch), Image.LANCZOS).resize((w // pitch * pitch, h // pitch * pitch), Image.NEAREST)
    cell = Image.new('RGB', (pitch, pitch))
    for x, c in enumerate([(255, 110, 110), (110, 255, 110), (110, 110, 255)][:pitch]):
        for y in range(pitch):
            cell.putpixel((x, y), c if y < pitch - 1 else tuple(v // 2 for v in c))
    mask = Image.new('RGB', small.size)
    for x in range(0, small.size[0], pitch):
        for y in range(0, small.size[1], pitch):
            mask.paste(cell, (x, y))
    lit = ImageChops.multiply(small, mask).point(lambda v: min(255, int(v * 1.5)))
    out = Image.new('RGB', (w, h)); out.paste(lit, (0, 0))
    return out

here = os.path.dirname(os.path.abspath(__file__))
tmp = tempfile.mkdtemp()
n = 0
for L, blur, screen in [(110, 0, False), (800, 0, False), (800, 8, False), (800, 0, True)]:   # 3 s chacun à 10 i/s
    im = regplane(L, blur)
    if screen:
        im = on_screen(im)
    for _ in range(30):
        camera(im).save(f'{tmp}/f{n:04d}.png'); n += 1
subprocess.run([ffmpeg(),'-y', '-loglevel', 'error', '-framerate', '10', '-i', f'{tmp}/f%04d.png',
                '-pix_fmt', 'yuv420p', os.path.join(here, 'cam.y4m')], check=True)
shutil.rmtree(tmp)
print('tests/cam.y4m prêt')
