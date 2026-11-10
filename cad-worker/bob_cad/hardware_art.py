"""Identification drawings for guide legends, in a 76 by 76 user-space box."""
import base64
import io
import re
import xml.etree.ElementTree as ET

from PIL import Image, ImageChops, ImageOps

NS = 'http://www.w3.org/2000/svg'
# Deliberately schematic; the outlines identify the part without specifying a drill pattern.
OUTLINES = {
    'reinforced-angle': (
        'M10 17 31 8 31 36 62 49 40 61 10 47 Z',
        'M10 17 12 17 12 44 40 57 62 46 31 33 M40 57 40 61',
        'M18 40 18 24 35 47 Z'),
    'u-channel': (
        'M10 27 43 10 46 12 46 31 60 38 60 19 63 17 66 19 66 44 33 61 10 49 Z',
        'M10 27 13 29 46 12 M13 29 13 47 29 55 29 36 60 19 M29 36 33 38 66 19 M33 38 33 61',
        'M13 47 46 31',
    ),
    'splice-plate': (
        'M6 46 52 17 68 24 68 27 22 56 6 49 Z',
        'M6 46 22 53 68 24 M22 53 22 56',
    ),
    'hook-pair': (
        'M6 23 18 17 18 50 6 57 Z M18 28 28 23 28 18 33 16 33 28 18 37 Z',
        'M41 24 62 14 62 49 41 60 Z M48 32 56 28 56 38 48 42 Z',
    ),
    'fluted-dowel': (
        'M12 43 49 18 C56 12 68 25 61 32 L24 57 C17 63 5 50 12 43 Z',
        'M12 43 C19 38 30 52 24 57 M19 43 52 21 M24 47 57 25 M26 51 60 29',
    ),
    'bed-bolt': (
        'M8 28 C8 21 13 18 16 21 L16 34 C12 38 8 35 8 28 Z M16 24 61 21 63 23 63 26 16 30 Z',
        'M46 23 48 27 M50 22 52 27 M54 22 56 26 M58 22 60 26',
        'M47 44 C51 38 64 39 65 46 L65 56 C63 64 47 63 47 56 Z M47 45 C49 52 64 52 65 45',
        'M51 46 60 42 M54 54 Q59 50 59 55 Q57 61 54 59 Q52 58 54 54 Z',
    ),
}

def draw_item(parent, art):
    if art in OUTLINES:
        group = ET.SubElement(parent, f'{{{NS}}}g', {'data-hardware-art': art, 'fill': 'white',
                              'stroke': '#111', 'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round'})
        for path in OUTLINES[art]:
            ET.SubElement(group, f'{{{NS}}}path', {'d': path, 'fill': 'none'})
        return True
    if isinstance(art, str) and len(art) <= 2400 and re.fullmatch(r'iVBORw0KGgo[A-Za-z0-9+/]*={0,2}', art):
        ET.SubElement(parent, f'{{{NS}}}image', {'x': '1', 'y': '1', 'width': '72', 'height': '72',
            '{http://www.w3.org/1999/xlink}href': 'data:image/png;base64,' + art})
        return True
    return False


def guide_thumbnail(encoded):
    """Only locally decoded raster pixels leave this boundary. No SVG or external image references."""
    data = base64.b64decode(encoded, validate=True)
    with Image.open(io.BytesIO(data), formats=['PNG', 'JPEG', 'WEBP']) as source:
        if source.width * source.height > 4096**2:
            raise ValueError('guide_thumbnail_size')
        pixels = source.convert('RGBA')
        white = Image.new('RGB', pixels.size, 'white')
        white.paste(pixels, mask=pixels.getchannel('A'))
        gray = ImageOps.grayscale(white)
        ink = ImageChops.invert(gray).point(lambda value: 255 if value > 75 else 0).getbbox()
        if not ink:
            raise ValueError('guide_thumbnail_blank')
        gray = ImageOps.contain(gray.crop(ink), (88, 88), Image.Resampling.LANCZOS)
        square = Image.new('L', (96, 96), 255)
        square.paste(gray, ((96-gray.width)//2, (96-gray.height)//2))
        out = io.BytesIO()
        square.point(lambda value: 255 if value >= 185 else 0, mode='1').save(out, format='PNG')
        return base64.b64encode(out.getvalue()).decode('ascii')
