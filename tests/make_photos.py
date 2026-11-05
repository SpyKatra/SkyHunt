"""Photos JPEG pour tests/anti-triche.js (empreinte des photos, anti-doublons).

python tests/make_photos.py <dossier>
  original.jpg  : avion dessiné + bruit de capteur (1920 × 1080)
  copie.jpg     : la même photo recompressée (JPEG 70 %) et réduite à 1600 px : doit être vue comme un double
  autre.jpg     : un autre avion, ailleurs dans l'image, autre ciel : ne doit PAS être vu comme un double
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from plane import draw  # noqa: E402

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
rng = np.random.default_rng(1)


def sensor(im, sigma=4):
    a = np.asarray(im).astype(np.float32)
    a += rng.normal(0, sigma, a.shape)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


orig = sensor(draw(W=1920, H=1080, cx=960, cy=540, L=1300))
orig.save(os.path.join(out, 'original.jpg'), quality=90)
Image.open(os.path.join(out, 'original.jpg')).resize((1600, 900)).save(os.path.join(out, 'copie.jpg'), quality=70)
other = sensor(draw(W=1920, H=1080, cx=700, cy=330, L=900)).transpose(Image.FLIP_LEFT_RIGHT)
other.save(os.path.join(out, 'autre.jpg'), quality=90)
print('ok')
