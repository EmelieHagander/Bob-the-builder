#!/usr/bin/env python3
"""Export Bob's existing SVG identity. Requires Pillow 12.3.0 (export only).

Run from any directory: python3 scripts/render-icons.py
Only rect/polygon geometry is supported; reject other shapes rather than drift.
"""
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'public/favicon.svg'
SVG = ET.parse(SOURCE).getroot()
assert SVG.get('viewBox') == '0 0 100 100'
SHAPES = list(SVG)
BACKGROUND = SHAPES[0].get('fill')
EXPORTS = [
    ('favicon.png', 32, False),
    ('icons/favicon-16.png', 16, False),
    ('icons/apple-touch-icon.png', 180, True),
    ('icons/icon-192.png', 192, False),
    ('icons/icon-512.png', 512, False),
    ('icons/maskable-512.png', 512, True),
]


def render(size, full_bleed):
    scale = size * 4 / 100
    canvas = Image.new('RGBA', (size * 4, size * 4), BACKGROUND if full_bleed else (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    for shape in SHAPES:
        tag = shape.tag.split('}')[-1]
        assert set(shape.attrib) <= {'x', 'y', 'width', 'height', 'rx', 'fill', 'points'}, 'Update exporter for new SVG attributes'
        if tag == 'rect':
            x, y = float(shape.get('x', 0)), float(shape.get('y', 0))
            w, h = float(shape.get('width')), float(shape.get('height'))
            bounds = [x * scale, y * scale, (x + w) * scale - 1, (y + h) * scale - 1]
            draw.rounded_rectangle(bounds, radius=float(shape.get('rx', 0)) * scale, fill=shape.get('fill'))
        elif tag == 'polygon':
            points = [tuple(float(v) * scale for v in point.split(',')) for point in shape.get('points').split()]
            draw.polygon(points, fill=shape.get('fill'))
        else:
            raise ValueError(f'Unsupported source shape: {tag}')
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


records = []
for path, size, full_bleed in EXPORTS:
    target = ROOT / 'public' / path
    target.parent.mkdir(parents=True, exist_ok=True)
    render(size, full_bleed).save(target, optimize=False)
    records.append({'path': path, 'size': size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})

bundle = {
    'source': 'public/favicon.svg',
    'source_sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    'generator': 'scripts/render-icons.py',
    'exports': records,
}
(ROOT / 'public/icons/bundle.json').write_text(json.dumps(bundle, indent=2) + '\n')
print(f'Exported {len(records)} icons from {SOURCE.relative_to(ROOT)}')
