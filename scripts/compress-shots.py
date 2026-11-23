# Re-encodes docs/screenshots/*.jpg to stay under 200 KB each: lower JPEG quality first, then scale down.
# Usage: python scripts/compress-shots.py  (needs Pillow)
import glob
import os

from PIL import Image

LIMIT = 195 * 1024
for f in sorted(glob.glob('docs/screenshots/*.jpg')):
    src = Image.open(f).convert('RGB')
    im, q = src, 80
    while True:
        im.save(f, 'JPEG', quality=q, optimize=True, progressive=True)
        if os.path.getsize(f) < LIMIT:
            break
        if q > 50:
            q -= 5
        else:
            im = im.resize((int(im.width * 0.9), int(im.height * 0.9)), Image.LANCZOS)
    print(f'{f}: {os.path.getsize(f) // 1024} KB, quality {q}, {im.width}x{im.height}')
