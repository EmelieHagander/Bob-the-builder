"""Build-guide pages (IKEA-style) from the exact saved construction.

A step is a set of saved joints, in an order Bob proposed and the owner can change.
Each page draws the parts already in place in grey, the step's new parts lifted out
of place in black with arrows, and the fasteners the server's fixed rules propose for
those joints. Nothing here invents geometry, order or hardware: unknowns are shown
as unknown. Concept presentation only, like the drawing sheets."""
from __future__ import annotations

import hashlib, itertools, math, re, shutil, xml.etree.ElementTree as ET
from pathlib import Path
from cairosvg import svg2png
from build123d import Align, Compound, Cone, Cylinder, ExportSVG, Location, Unit
from .annotations import part_name, blank_text, marker_ranges, _number
from .worker import CadContractError, ID, _location, _shape, validate_drawing_source, validate_fasteners, validate_request

NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)
GUIDE_VERSION = 1
# 2026-11-09: pages are stored one by one outside the drawing, so a guide has no
# row-size ceiling; one call draws at most RANGE_STEPS of its steps.
MAX_PAGES = 999
RANGE_STEPS = 24
_LAYERS = itertools.count()
PAGE_W, PAGE_H = 1000, 750
TOUCH_MM = 0.5
ITEM_KEY = re.compile(r'[0-9a-fA-F-]{1,64}@[0-9]{1,9}')
CAMERAS = {'isometric': (1, -1, 1), 'isometric_front_left': (-1, -1, 1),
           'isometric_back_left': (-1, 1, 1), 'isometric_back_right': (1, 1, 1)}
KIND_NAMES = {'screw': 'Screw', 'nail': 'Nail', 'bolt': 'Bolt'}
# 2026-11-01: hardware the designer adds (dowels, brackets ...) names itself.
def kind_name(kind): return KIND_NAMES.get(kind) or kind.replace('_', ' ').capitalize()
def size_text(d, l):
    """Only the sizes the schedule knows: '5 × 120', 'Ø 10 mm', '50 mm' (2026-11-10: never '?')."""
    if d is not None and l is not None: return f' {_number(d)} × {_number(l)}'
    return f' Ø {_number(d)} mm' if d is not None else f' {_number(l)} mm' if l is not None else ''
def hardware_words(row): return row.get('name') or f'{kind_name(row["kind"])}{size_text(row["diameter_mm"], row["length_mm"])}'
def counted(j): return j.get('counting') in ('along_contact', 'per_joint') if j.get('counting') else j['kind'] in KIND_NAMES
INK, CONTEXT = '#111111', '#9a9a9a'


def _v(a, b): return [a[k] - b[k] for k in range(3)]
def _dot(a, b): return sum(x * y for x, y in zip(a, b))
def _cross(a, b): return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
def _unit(a):
    n = math.sqrt(_dot(a, a))
    return [x / n for x in a]


def validate_item_names(names):
    """Catalog names of chosen hardware ('<item id>@<revision>' -> name), as the server read them."""
    if names is not None and (not isinstance(names, dict) or len(names) > 256 or any(
            not isinstance(k, str) or not ITEM_KEY.fullmatch(k) or not isinstance(v, str) or not 1 <= len(v.strip()) <= 200 for k, v in names.items())):
        raise CadContractError('guide_item_names')


def validate_guide(joints, steps, ids):
    """Joints as saved (id, first/second instance ends); steps = ordered lists of joint ids."""
    if not isinstance(joints, list) or len(joints) > 1024: raise CadContractError('guide_joints')
    known = {}
    for j in joints:
        if (not isinstance(j, dict) or not isinstance(j.get('id'), str) or not ID.fullmatch(j['id']) or j['id'] in known
                or any(not isinstance(j.get(end), dict) or j[end].get('instance_id') not in ids for end in ('first', 'second'))
                or j['first']['instance_id'] == j['second']['instance_id']): raise CadContractError('guide_joint')
        known[j['id']] = (j['first']['instance_id'], j['second']['instance_id'])
    if not isinstance(steps, list) or not 1 <= len(steps) <= 997: raise CadContractError('guide_steps')
    used = set()
    for s in steps:
        # A step may name the guide section it belongs to (2026-11-09); it is printed on the page.
        if (not isinstance(s, dict) or set(s) - {'section'} != {'joint_ids'} or not isinstance(s['joint_ids'], list) or not s['joint_ids']
                or 'section' in s and not (isinstance(s['section'], str) and 1 <= len(s['section'].strip()) <= 80)
                or any(i not in known or i in used for i in s['joint_ids'])): raise CadContractError('guide_step')
        used.update(s['joint_ids'])
    return known


def _contact(a, b):
    """Touching boxes: (normal axis, sign from a to b, overlap box) or None."""
    gaps = [min(a['max'][k], b['max'][k]) - max(a['min'][k], b['min'][k]) for k in range(3)]
    flat = [k for k in range(3) if abs(gaps[k]) <= TOUCH_MM]
    if len(flat) != 1 or any(gaps[k] <= TOUCH_MM for k in range(3) if k != flat[0]): return None
    n = flat[0]
    sign = 1 if (a['min'][n] + a['max'][n]) < (b['min'][n] + b['max'][n]) else -1
    lo = [max(a['min'][k], b['min'][k]) for k in range(3)]; hi = [min(a['max'][k], b['max'][k]) for k in range(3)]
    return n, sign, lo, hi


def _lift_direction(mover, bases, boxes, center):
    """A free direction to lift a new part away from the parts it joins: never into one of
    them; prefer straight up, then away from the assembly's middle."""
    blocked = set()
    for base in bases:
        touch = _contact(boxes[base], boxes[mover])
        if touch:
            n, sign, _, _ = touch
            blocked.add((n, -sign))  # moving toward the base
    options = [(2, 1), (0, 1), (0, -1), (1, 1), (1, -1), (2, -1)]
    mid = [(boxes[mover]['min'][k] + boxes[mover]['max'][k]) / 2 for k in range(3)]
    free = [o for o in options if o not in blocked]
    if (2, 1) in free: return (2, 1)
    free.sort(key=lambda o: -o[1] * (mid[o[0]] - center[o[0]]))
    return free[0] if free else (2, 1)


def _clear_lift(mover, axis, sign, boxes, staying, base, margin):
    """Lift far enough that a part going into a frame or box is drawn clear of it,
    not floating inside it."""
    if not staying: return base
    b = boxes[mover]
    lo = [min(boxes[i]['min'][k] for i in staying) for k in range(3)]
    hi = [max(boxes[i]['max'][k] for i in staying) for k in range(3)]
    if any(min(b['max'][k], hi[k]) - max(b['min'][k], lo[k]) <= TOUCH_MM for k in range(3) if k != axis): return base
    need = hi[axis] - b['min'][axis] if sign > 0 else b['max'][axis] - lo[axis]
    return max(base, need + margin)


def _move_arrows(b, axis, sign, lift, cam, size):
    """Arrows from the lifted part back to its place, along its camera-facing edge
    (just inside it, so they point into where the part goes) and below or beside the
    part so it hides as little of them as possible."""
    perp = [k for k in range(3) if k != axis]
    along = max(perp, key=lambda k: b['max'][k] - b['min'][k]); side = perp[0] if perp[1] == along else perp[1]
    out = 1 if cam[side] >= 0 else -1; clear = -min(max(size * 0.03, 15), (b['max'][side] - b['min'][side]) * 0.25)
    lead = b['min'][axis] if sign > 0 else b['max'][axis]
    arrows = []
    for f in ((0.2, 0.8) if b['max'][along] - b['min'][along] > size * 0.3 else (0.5,)):
        p = [0.0, 0.0, 0.0]; p[along] = b['min'][along] + f * (b['max'][along] - b['min'][along])
        p[side] = (b['max'][side] if out > 0 else b['min'][side]) + out * clear
        start = list(p); start[axis] = lead + sign * (lift - 12)
        end = list(p); end[axis] = lead + sign * 12
        arrows += _arrow(start, end, size)
    return arrows


def _arrow(start, end, size):
    """Shaft and head as solids from start to end along one axis, so they project with the parts."""
    d = _v(end, start); axis = max(range(3), key=lambda k: abs(d[k])); length = abs(d[axis]); sign = 1 if d[axis] > 0 else -1
    head = min(size * 0.05, length * 0.45); r = max(size * 0.006, 4)
    rot = {(2, 1): (0, 0, 0), (2, -1): (180, 0, 0), (0, 1): (0, 90, 0), (0, -1): (0, -90, 0), (1, 1): (-90, 0, 0), (1, -1): (90, 0, 0)}[(axis, sign)]
    base = Location(tuple(start), rot)
    shaft = base * Cylinder(r, length - head, align=(Align.CENTER, Align.CENTER, Align.MIN))
    tip = base * Location((0, 0, length - head)) * Cone(r * 2.6, 0, head, align=(Align.CENTER, Align.CENTER, Align.MIN))
    return [shaft, tip]


class _View:
    """One camera shared by every layer on a page, mapped into a page rectangle."""
    def __init__(self, shapes, camera, frame, scratch):
        self.scratch = scratch
        asm = Compound(children=shapes); bb = asm.bounding_box()
        self.center = [(bb.min.X + bb.max.X) / 2, (bb.min.Y + bb.max.Y) / 2, (bb.min.Z + bb.max.Z) / 2]
        d = max(bb.size.X, bb.size.Y, bb.size.Z) * 4
        self.camera = [self.center[k] + camera[k] * d for k in range(3)]
        self.z = _unit(_v(self.camera, self.center)); self.x = _unit(_cross((0, 0, 1), self.z)); self.y = _cross(self.z, self.x)
        pts = [self._plane([cx, cy, cz]) for cx in (bb.min.X, bb.max.X) for cy in (bb.min.Y, bb.max.Y) for cz in (bb.min.Z, bb.max.Z)]
        left, right = min(p[0] for p in pts), max(p[0] for p in pts); top, bottom = min(p[1] for p in pts), max(p[1] for p in pts)
        fx, fy, fw, fh = frame
        self.scale = min(fw / max(right - left, 1), fh / max(bottom - top, 1))
        self.dx = fx + (fw - (right - left) * self.scale) / 2 - left * self.scale
        self.dy = fy + (fh - (bottom - top) * self.scale) / 2 - top * self.scale

    def _plane(self, p):
        delta = _v(p, self.camera)
        return [_dot(delta, self.x), -_dot(delta, self.y)]

    def point(self, p):
        x, y = self._plane(p)
        return [self.dx + x * self.scale, self.dy + y * self.scale]

    def layer(self, page, shapes, colour, width):
        if not shapes: return
        visible, _ = Compound(children=shapes).project_to_viewport(tuple(self.camera), viewport_up=(0, 0, 1), look_at=tuple(self.center))
        svg = ExportSVG(unit=Unit.MM, scale=1, margin=0, precision=3); svg.add_layer('V'); svg.add_shape(visible, layer='V')
        path = self.scratch / f'layer-{next(_LAYERS)}.svg'; svg.write(str(path))
        root = ET.parse(path).getroot(); path.unlink(missing_ok=True)
        g = ET.SubElement(page, f'{{{NS}}}g', {'transform': f'translate({self.dx},{self.dy}) scale({self.scale})',
                                               'fill': 'none', 'stroke': colour, 'stroke-width': str(width / self.scale),
                                               'stroke-linecap': 'round', 'stroke-linejoin': 'round'})
        for child in list(root):
            for el in child.iter():
                for key in ('stroke', 'stroke-width', 'fill'): el.attrib.pop(key, None)
            g.append(child)


def _page(height=PAGE_H):
    page = ET.Element(f'{{{NS}}}svg', {'width': str(PAGE_W), 'height': str(height), 'viewBox': f'0 0 {PAGE_W} {height}'})
    ET.SubElement(page, f'{{{NS}}}rect', {'width': str(PAGE_W), 'height': str(height), 'fill': '#ffffff'})
    return page


def _text(page, x, y, value, size=16, weight='400', anchor='start', fill=INK):
    el = ET.SubElement(page, f'{{{NS}}}text', {'x': _r(x), 'y': _r(y), 'font-size': _r(size), 'font-weight': weight,
                                               'text-anchor': anchor, 'fill': fill, 'font-family': 'sans-serif'})
    el.text = value


def _r(v): return f'{v:.2f}'.rstrip('0').rstrip('.') if isinstance(v, float) else str(v)


# Text layout (2026-11-10). Pages are read on phones whose sans-serif differs from
# the renderer's, so widths come from Helvetica metrics with a margin. Every label is
# fitted to its space when drawn, and layout_issues() measures the finished page the
# same way: text that overlaps, leaves the page or crosses a frame is a defect.
_HELVETICA = dict(zip(map(chr, range(32, 127)), [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
    556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
    556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]))
TEXT_MARGIN = 1.08


def text_width(value, size, weight='400'):
    em = sum(_HELVETICA.get(c, 600) for c in value) / 1000
    return em * size * TEXT_MARGIN * (1.07 if int(weight) >= 600 else 1)


def _wrap(value, size, weight, width, lines):
    """Words onto at most `lines` lines no wider than width, or None when they do not fit."""
    out, words = [], value.split()
    for word in words:
        if out and text_width(out[-1] + ' ' + word, size, weight) <= width: out[-1] += ' ' + word
        else: out.append(word)
    return out if len(out) <= lines and all(text_width(l, size, weight) <= width for l in out) else None


def _fit(page, x, y, value, size, width, weight='400', anchor='start', fill=INK, lines=1, smallest=None):
    """Draw value inside `width`: the given size if it fits, else smaller, else over up
    to `lines` lines (going down from y), else cut with an ellipsis at the smallest size."""
    smallest = smallest or max(8, size * 0.7)
    s = size
    while True:
        rows = _wrap(value, s, weight, width, 1) or (_wrap(value, s, weight, width, lines) if lines > 1 else None)
        if rows or s <= smallest: break
        s = max(smallest, s - 0.5)
    if not rows:
        cut = value
        while cut and text_width(cut + '…', s, weight) > width: cut = cut[:-1]
        rows = [cut.rstrip() + '…']
    for n, row in enumerate(rows): _text(page, x, y + n * s * 1.2, row, s, weight, anchor, fill)
    return s, len(rows)


def _text_box(el):
    """Estimated box (left, top, right, bottom) of an SVG text element."""
    size = float(el.get('font-size')); w = text_width(el.text or '', size, el.get('font-weight', '400'))
    x = float(el.get('x')); y = float(el.get('y'))
    left = x - {'middle': w / 2, 'end': w}.get(el.get('text-anchor'), 0)
    return (left, y - 0.78 * size, left + w, y + 0.22 * size)


def layout_issues(svg):
    """The visual check of one page: text off the page, text over other text, and text
    crossing the edge of a frame. Returns readable defects; [] is a clean page."""
    root = ET.fromstring(svg) if isinstance(svg, (bytes, str)) else svg
    _, _, w, h = (float(v) for v in root.get('viewBox').split())
    texts, frames, issues = [], [], []
    def walk(el, transformed):
        for child in el:
            tag = child.tag.split('}')[-1]
            moved = transformed or 'transform' in child.attrib
            if tag == 'text':
                if moved: issues.append(f'text "{child.text}" is transformed, so it cannot be measured')
                else: texts.append((child.text or '', _text_box(child)))
            elif tag == 'rect' and child.get('fill') == 'none' and not moved:
                x, y = float(child.get('x', 0)), float(child.get('y', 0))
                frames.append((x, y, x + float(child.get('width')), y + float(child.get('height'))))
            walk(child, moved)
    walk(root, False)
    def overlap(a, b, pad=0.5):
        return min(a[2], b[2]) - max(a[0], b[0]) > pad and min(a[3], b[3]) - max(a[1], b[1]) > pad
    for value, b in texts:
        if b[0] < -0.5 or b[1] < -0.5 or b[2] > w + 0.5 or b[3] > h + 0.5: issues.append(f'text "{value}" leaves the page')
        for f in frames:
            inside = b[0] >= f[0] - 0.5 and b[2] <= f[2] + 0.5 and b[1] >= f[1] - 0.5 and b[3] <= f[3] + 0.5
            if overlap(b, f) and not inside: issues.append(f'text "{value}" crosses a frame')
    for i, (va, a) in enumerate(texts):
        for vb, b in texts[i + 1:]:
            if overlap(a, b): issues.append(f'text "{va}" overlaps "{vb}"')
    return issues


def _line(page, a, b, width=2, colour=INK, dashed=False):
    attrs = {'x1': str(a[0]), 'y1': str(a[1]), 'x2': str(b[0]), 'y2': str(b[1]),
             'stroke': colour, 'stroke-width': str(width), 'stroke-linecap': 'round'}
    if dashed: attrs['stroke-dasharray'] = '5 4'
    ET.SubElement(page, f'{{{NS}}}line', attrs)


def _head(page, kind, cx, cy, hidden=False):
    """A fastener head seen from where it goes in: screw = cross head, nail = dot,
    bolt = hexagon. Dashed when it goes in from the side facing away."""
    g = ET.SubElement(page, f'{{{NS}}}g', {'fill': '#ffffff', 'stroke': INK, 'stroke-width': '2', 'data-head': kind + (' hidden' if hidden else '')})
    if hidden: g.set('stroke-dasharray', '3 2')
    if kind == 'bolt':
        pts = ' '.join(f'{cx + 8 * math.cos(math.pi / 3 * k):.1f},{cy + 8 * math.sin(math.pi / 3 * k):.1f}' for k in range(6))
        ET.SubElement(g, f'{{{NS}}}polygon', {'points': pts})
    elif kind == 'nail':
        ET.SubElement(g, f'{{{NS}}}circle', {'cx': str(cx), 'cy': str(cy), 'r': '5', 'fill': '#ffffff' if hidden else INK})
    elif kind == 'screw':
        ET.SubElement(g, f'{{{NS}}}circle', {'cx': str(cx), 'cy': str(cy), 'r': '7'})
        ET.SubElement(g, f'{{{NS}}}path', {'d': f'M{cx - 4} {cy} L{cx + 4} {cy} M{cx} {cy - 4} L{cx} {cy + 4}', 'fill': 'none'})
    else:
        # Hardware the designer added (2026-11-01): a plain end, named in the box list.
        ET.SubElement(g, f'{{{NS}}}circle', {'cx': str(cx), 'cy': str(cy), 'r': '6'})


def _part_labels(page, wanted):
    """Part numbers over the lifted parts: each at its part, moved the least distance that keeps
    it clear of the labels already placed, on a white backing so drawing lines stay readable."""
    placed = []
    for (x, y), value in wanted:
        w = text_width(value, 15, '700'); h = 18
        for dy, dx in [(0, 0)] + [(d * sy, d * sx) for d in (20, 40, 60, 80, 100) for sy, sx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1))]:
            cx = min(max(x + dx * w / 20, 320 + w / 2), PAGE_W - 30 - w / 2); cy = min(max(y - 10 + dy, 60 + h), 690)
            box = (cx - w / 2 - 3, cy - 0.78 * 15 - 2, cx + w / 2 + 3, cy + 0.22 * 15 + 2)
            if all(min(box[2], o[2]) <= max(box[0], o[0]) or min(box[3], o[3]) <= max(box[1], o[1]) for o in placed): break
        placed.append(box)
        ET.SubElement(page, f'{{{NS}}}rect', {'x': _r(box[0]), 'y': _r(box[1]), 'width': _r(box[2] - box[0]), 'height': _r(box[3] - box[1]),
                                              'rx': '3', 'fill': '#ffffff', 'fill-opacity': '0.85'})
        _text(page, cx, cy, value, 15, '700', 'middle')


def _glyph(page, kind, x, y):
    """Small pictograms for the parts box: screw, nail, bolt, glue."""
    g = ET.SubElement(page, f'{{{NS}}}g', {'fill': 'none', 'stroke': INK, 'stroke-width': '2.2', 'stroke-linecap': 'round'})
    if kind == 'glue':
        ET.SubElement(g, f'{{{NS}}}rect', {'x': str(x + 22), 'y': str(y + 18), 'width': '26', 'height': '44', 'rx': '5'})
        ET.SubElement(g, f'{{{NS}}}path', {'d': f'M{x+30} {y+18} L{x+33} {y+6} L{x+37} {y+6} L{x+40} {y+18}'})
        return
    ET.SubElement(g, f'{{{NS}}}line', {'x1': str(x + 35), 'y1': str(y + 14), 'x2': str(x + 35), 'y2': str(y + 66)})
    if kind == 'bolt':
        ET.SubElement(g, f'{{{NS}}}polygon', {'points': f'{x+25},{y+14} {x+30},{y+6} {x+40},{y+6} {x+45},{y+14}'})
    else:
        ET.SubElement(g, f'{{{NS}}}line', {'x1': str(x + 24), 'y1': str(y + 12), 'x2': str(x + 46), 'y2': str(y + 12)})
    if kind == 'screw':
        for t in range(4): ET.SubElement(g, f'{{{NS}}}line', {'x1': str(x + 31), 'y1': str(y + 30 + t * 9), 'x2': str(x + 39), 'y2': str(y + 25 + t * 9)})


def fastener_rows(joint_ids, schedule, names=None):
    """Per-step hardware from the server's rule schedule, never guessed: grouped sized rows,
    glue, and joints without a rule or size (shown with '?')."""
    if schedule is None: return [], [], False
    by = {}
    for j in schedule['joints']: by.setdefault(j['joint_id'], []).append(j)
    groups, unsized, glue, packages = {}, [], False, set()
    for jid in joint_ids:
        rows = by.get(jid)
        if not rows: unsized.append(jid); continue
        for j in rows:
            # No rule, nothing chosen yet, or a chosen item the catalog no longer resolves.
            if j['source'] in ('no_rule', 'none') or (j['source'] == 'chosen' and j['kind'] is None): unsized.append(jid); continue
            if j['kind'] == 'glue': glue = True; continue
            # A chosen catalog item keeps its own name (2026-11-10), so the box page reads as a shopping list.
            name = (names or {}).get(f"{j.get('material_id')}@{j.get('material_revision')}")
            if j.get('counting') == 'per_construction': packages.add((j['kind'], j['diameter_mm'], j['length_mm'], name)); continue
            if j['kind'] and counted(j):
                if j['count'] is None or (j['kind'] in KIND_NAMES and None in (j['diameter_mm'], j['length_mm'])): unsized.append(jid); continue
                key = (j['kind'], j['diameter_mm'], j['length_mm'], name)
                groups[key] = groups.get(key, 0) + j['count']
    for key in packages: groups.setdefault(key, 1)
    order = lambda item: (item[0][0], item[0][1] if item[0][1] is not None else -1, item[0][2] if item[0][2] is not None else -1, item[0][3] or '')
    rows = [{'kind': k, 'diameter_mm': d, 'length_mm': l, 'count': c, **({'name': n} if n else {})} for (k, d, l, n), c in sorted(groups.items(), key=order)]
    return rows, sorted(set(unsized)), glue


def glue_name(joint_ids, schedule, names):
    """The chosen glue's catalog name, when the schedule names one item."""
    found = {(names or {}).get(f"{j.get('material_id')}@{j.get('material_revision')}") for j in (schedule or {'joints': []})['joints']
             if j['joint_id'] in set(joint_ids) and j['kind'] == 'glue'} - {None}
    return found.pop() if len(found) == 1 else None


def tools_needed(rows, glue, cut=True):
    """Tools for the box page, from fixed rules over the parts and the scheduled hardware
    (2026-11-10). A proposal like the fastener counts, never a claim about the build."""
    kinds = {r['kind'] for r in rows}
    tools = ['Tape measure', 'Pencil', 'Try square'] + (['Saw'] if cut else [])
    if kinds - {'nail'}: tools.append('Drill driver with bits')
    for kind in ('dowel', 'bolt'):
        for d in sorted({r['diameter_mm'] for r in rows if r['kind'] == kind and r['diameter_mm'] is not None}):
            tools.append(f'Drill bit Ø {_number(d)} mm ({kind} holes)')
    if 'bolt' in kinds: tools.append('Spanner or hex key for the bolts')
    if kinds & {'nail', 'dowel'}: tools.append('Hammer or mallet')
    if glue: tools += ['Clamps', 'Damp cloth for glue']
    return list(dict.fromkeys(tools))


def _components(joint_ids, joints):
    parent = {}
    def find(a):
        while parent.setdefault(a, a) != a: a = parent[a]
        return a
    for jid in joint_ids:
        a, b = joints[jid]; parent[find(a)] = find(b)
    groups = {}
    for jid in joint_ids:
        a, _ = joints[jid]; groups.setdefault(find(a), []).append(jid)
    return list(groups.values())


def _signature(joint_ids, joints, boxes, defs_of):
    ids = sorted({i for jid in joint_ids for i in joints[jid]})
    lo = [min(boxes[i]['min'][k] for i in ids) for k in range(3)]
    return tuple(sorted((defs_of[i], tuple(round(boxes[i]['min'][k] - lo[k], 1) for k in range(3)),
                         tuple(round(boxes[i]['max'][k] - lo[k], 1) for k in range(3))) for i in ids))


def _plan(steps, joint_ends, boxes, defs_of):
    """One page per step (2026-11-09): the page count is the step count, so the
    order Bob gives decides it, never the geometry. Identical sub-assemblies in
    a step are drawn once ('N×'); a step that joins different things draws them
    together on its one page."""
    plan = []
    for step in steps:
        comps = _components(step['joint_ids'], joint_ends)
        sigs = {_signature(comp, joint_ends, boxes, defs_of) for comp in comps}
        copies = comps if len(sigs) == 1 else [sorted(jid for comp in comps for jid in comp)]
        plan.append((step, [{'copies': copies}]))
    return plan


def render_guide(raw, joints, steps, output_dir, fasteners=None, context_ids=(), size=(1500, 1125), drawing_source=None, svg_only=False, step_range=None, item_names=None):
    out = Path(output_dir); out.mkdir(parents=True, exist_ok=True)
    scratch = out / '.layers'; scratch.mkdir(exist_ok=True)
    try:
        return _render_guide(raw, joints, steps, out, scratch, fasteners, context_ids, size, drawing_source, svg_only, step_range, item_names)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def _render_guide(raw, joints, steps, out, scratch, fasteners, context_ids, size, drawing_source, svg_only, step_range, item_names):
    req = validate_request(raw)
    validate_item_names(item_names)
    validate_drawing_source(drawing_source)
    if not isinstance(context_ids, (list, tuple)) or len(set(context_ids)) != len(context_ids): raise CadContractError('guide_context')
    ids = [i['id'] for i in req['instances']]
    joint_ends = validate_guide(joints, steps, set(ids))
    if fasteners is not None: validate_fasteners(fasteners)
    if any(i not in ids for i in context_ids): raise CadContractError('guide_context')
    defs = {d['id']: _shape(d) for d in req['definitions']}; definitions = {d['id']: d for d in req['definitions']}
    defs_of = {i['id']: i['definition_id'] for i in req['instances']}
    solids, boxes = {}, {}
    for inst in req['instances']:
        s = _location(inst['placement']) * defs[inst['definition_id']]; solids[inst['id']] = s; bb = s.bounding_box()
        boxes[inst['id']] = {'min': [bb.min.X, bb.min.Y, bb.min.Z], 'max': [bb.max.X, bb.max.Y, bb.max.Z]}
    numbers = {iid: n for n, iid in enumerate(sorted(ids), 1)}
    lo = [min(b['min'][k] for b in boxes.values()) for k in range(3)]; hi = [max(b['max'][k] for b in boxes.values()) for k in range(3)]
    center = [(lo[k] + hi[k]) / 2 for k in range(3)]; size_mm = max(hi[k] - lo[k] for k in range(3))
    plan = _plan(steps, joint_ends, boxes, defs_of)
    if len(plan) + 2 > MAX_PAGES: raise CadContractError('guide_too_many_pages')
    # A range draws steps [first, last) with their global numbers; the box page
    # comes with the first range and the done page with the last.
    first, last = (0, len(plan)) if step_range is None else step_range if isinstance(step_range, (list, tuple)) and len(step_range) == 2 else (None, None)
    if (not all(isinstance(v, int) and not isinstance(v, bool) for v in (first, last)) or not 0 <= first < last <= len(plan)
            or step_range is not None and last - first > RANGE_STEPS): raise CadContractError('guide_range')
    pages = []

    def label(part_ids):
        return ', '.join(marker_ranges(sorted(numbers[i] for i in part_ids)))

    def save(page, key, note):
        if note['kind'] == 'parts' and first > 0: return
        if drawing_source:
            # Every page names the exact construction it was drawn from.
            _text(page, PAGE_W - 30, 26, f'Construction version {drawing_source["revision"]} · ID {drawing_source["artifact_id"]}', 10, '400', 'end', '#555555')
        data = ET.tostring(page, encoding='utf-8', xml_declaration=False)
        # The visual check runs on every page drawn; a defect is counted in the page's notes.
        defects = layout_issues(page)
        if defects: note = {**note, 'layout_defects': len(defects)}
        (out / f'{key}.svg').write_bytes(data)
        if not svg_only:
            svg2png(bytestring=data, write_to=str(out / f'{key}.png'), output_width=size[0], output_height=round(size[1] * float(page.get('height')) / PAGE_H), background_color='white')
        pages.append({'key': key, 'sha256': hashlib.sha256(data).hexdigest(), **note})

    def parts_box(page, items, hardware, unsized, glue, y0=140, bottom=PAGE_H - 12):
        """The step's parts and hardware, rows shrunk together so the box always ends on the page."""
        rows = len(items) + len(hardware) + (1 if glue else 0) + (1 if unsized else 0)
        s = min(1.0, (bottom - y0 - 24) / max(rows * 84, 1)); rh = 84 * s
        ET.SubElement(page, f'{{{NS}}}rect', {'x': '40', 'y': _r(y0), 'width': '250', 'height': _r(24 + rows * rh), 'rx': '10',
                                              'fill': 'none', 'stroke': INK, 'stroke-width': '2'})
        y = y0 + 12; tx = 60 + 86 * s; tw = 280 - tx

        def symbol(kind, head=True):
            g = ET.SubElement(page, f'{{{NS}}}g', {'transform': f'translate(60 {_r(y)}) scale({_r(s)})'})
            _glyph(g, kind, 0, 0)
            if head: _head(g, kind, 66, 22)

        def words(big, small, big_size=26):
            _fit(page, tx, y + 34 * s, big, big_size * s, tw, '700')
            _fit(page, tx, y + 56 * s, small, 13 * s, tw, fill='#333333', lines=2, smallest=10 * s)
        for count, part_ids in items:
            _View([solids[part_ids[0]]], (1, -1, 1), (52, y, 80 * s, 72 * s), scratch).layer(page, [solids[part_ids[0]]], INK, 1.6)
            words(f'{count}×', f'{label(part_ids)} {part_name(defs_of[part_ids[0]])}'); y += rh
        for h in hardware:
            symbol(h['kind'], h['kind'] in KIND_NAMES)
            words(f'{h["count"]}×', f'{kind_name(h["kind"])}{size_text(h["diameter_mm"], h["length_mm"])}'); y += rh
        if glue: symbol('glue', False); words('Glue', 'on the joining faces', 22); y += rh
        if unsized: _text(page, 60, y + 34 * s, '?', 30 * s, '700'); words('No rule yet', f'{len(unsized)} joint(s): ask Bob', 16)

    def box_page():
        """What is in the box (2026-11-10): every part kind, every piece of hardware with its
        catalog name, glue and the tools, so the page works as the shopping list. The page
        grows taller instead of leaving anything out."""
        page = ET.Element('g'); _text(page, 40, 70, 'What is in the box', 30, '700')
        kinds = {}
        for iid in sorted(ids, key=lambda i: numbers[i]):
            if iid not in context_ids: kinds.setdefault(defs_of[iid], []).append(iid)
        cols = 4 if len(kinds) <= 8 else 5 if len(kinds) <= 15 else 6
        gap = 16; tile_w = (920 - (cols - 1) * gap) / cols; tile_h = 200
        y = 96
        for n, (did, members) in enumerate(kinds.items()):
            x = 40 + (n % cols) * (tile_w + gap); ty = y + (n // cols) * (tile_h + gap)
            ET.SubElement(page, f'{{{NS}}}rect', {'x': _r(x), 'y': _r(ty), 'width': _r(tile_w), 'height': str(tile_h), 'rx': '12', 'fill': 'none', 'stroke': INK, 'stroke-width': '2'})
            _View([solids[members[0]]], (1, -1, 1), (x + 14, ty + 12, tile_w - 28, 92), scratch).layer(page, [solids[members[0]]], INK, 1.8)
            _text(page, x + tile_w / 2, ty + 136, f'{len(members)}×', 28, '700', 'middle')
            _fit(page, x + tile_w / 2, ty + 158, f'{label(members)} {part_name(did)}', 14, tile_w - 16, '600', 'middle', lines=2, smallest=11)
            _fit(page, x + tile_w / 2, ty + 191, blank_text(definitions[did]), 12, tile_w - 16, '400', 'middle', '#333333', smallest=9)
        y += ((len(kinds) + cols - 1) // cols) * (tile_h + gap) + 24

        _text(page, 40, y + 20, 'Hardware', 22, '700'); y += 36
        rows, unsized, glue = fastener_rows([j['id'] for j in joints], fasteners, item_names)
        if fasteners is None:
            _text(page, 40, y + 22, 'The hardware schedule was not read for this guide.', 15, fill='#333333'); y += 40
        else:
            entries = [(r['kind'], f'{r["count"]}×', hardware_words(r), r['kind'] in KIND_NAMES) for r in rows]
            if glue: entries.append(('glue', '', glue_name([j['id'] for j in joints], fasteners, item_names) or 'Wood glue, for the glued joints', False))
            if unsized: entries.append(('?', '?', f'{len(unsized)} joint(s) have no hardware yet: ask Bob', False))
            if not entries: _text(page, 40, y + 22, 'No hardware.', 15, fill='#333333'); y += 40
            cw, ch = 452, 76
            for n, (kind, count, words, head) in enumerate(entries):
                x = 40 + (n % 2) * (cw + 16); ty = y + (n // 2) * (ch + 12)
                ET.SubElement(page, f'{{{NS}}}rect', {'x': str(x), 'y': _r(ty), 'width': str(cw), 'height': str(ch), 'rx': '10', 'fill': 'none', 'stroke': INK, 'stroke-width': '2'})
                if kind == '?': _text(page, x + 24, ty + 50, '?', 32, '700')
                else:
                    g = ET.SubElement(page, f'{{{NS}}}g', {'transform': f'translate({x + 4} {_r(ty + 2)}) scale(0.85)'}); _glyph(g, kind, 0, 0)
                    if head: _head(g, kind, 66, 22)
                if count: _fit(page, x + 76, ty + 47, count, 26, 80, '700')
                _fit(page, x + 162, ty + 32, words, 14, cw - 176, lines=3, smallest=11)
            y += ((len(entries) + 1) // 2) * (ch + 12) + 12

        _text(page, 40, y + 20, 'Tools', 22, '700'); y += 32
        tools = tools_needed(rows, glue, cut=bool(kinds))
        for n, tool in enumerate(tools):
            x = 40 + (n % 3) * 310; ty = y + (n // 3) * 30
            ET.SubElement(page, f'{{{NS}}}circle', {'cx': str(x + 6), 'cy': _r(ty + 17), 'r': '4', 'fill': INK})
            _fit(page, x + 18, ty + 22, tool, 15, 284)
        y += ((len(tools) + 2) // 3) * 30 + 16
        _fit(page, 40, y + 14, 'Hardware counts are rule-of-thumb proposals, not a strength check. Tools are suggested from the parts and hardware: check before you start.', 12, 920, fill='#333333', lines=2)
        height = max(PAGE_H, int(math.ceil(y + 44)))
        full = _page(height)
        for child in list(page): full.append(child)
        return full

    if first == 0: save(box_page(), 'guide-0', {'kind': 'parts'})

    placed = set(context_ids)
    number = 0
    for index, (step, groups) in enumerate(plan):
        if not first <= index < last:
            number += len(groups); placed |= {i for jid in step['joint_ids'] for i in joint_ends[jid]}
            continue
        for g in groups:
            number += 1
            comp = g['copies'][0]
            parts = sorted({i for jid in comp for i in joint_ends[jid]}, key=lambda i: numbers[i])
            bases = [i for i in parts if i in placed]
            if not bases:
                low = min(boxes[i]['min'][2] for i in parts); bases = [i for i in parts if abs(boxes[i]['min'][2] - low) <= TOUCH_MM]
            movers = [i for i in parts if i not in bases]
            lift_mm = max(size_mm * 0.22, 120)
            staying = [i for i in sorted(placed | set(parts)) if i not in movers]
            lifted, offsets, moves = [], {}, {}
            for m in movers:
                axis, sign = _lift_direction(m, bases, boxes, center)
                lift = _clear_lift(m, axis, sign, boxes, staying, lift_mm, max(size_mm * 0.08, 40))
                off = [0, 0, 0]; off[axis] = sign * lift; offsets[m] = off; moves[m] = (axis, sign, lift)
                lifted.append(Location(tuple(off)) * solids[m])
            hardware, unsized, glue = fastener_rows(comp, fasteners)
            # Choose the overview corner that shows the most screw heads, so fasteners are drawn on faces you can see.
            heads = []
            if fasteners is not None:
                by = {}
                for row in fasteners['joints']: by.setdefault(row['joint_id'], []).append(row)
                # Heads along the contact; hardware counted per joint has no placed positions.
                for jid, j in [(jid, row) for jid in comp for row in by.get(jid, [])]:
                    if not j['kind'] or not counted(j) or j.get('counting') == 'per_joint' or not j['count'] or j['through_instance_id'] not in parts: continue
                    t = j['through_instance_id']; o = [i for i in joint_ends[jid] if i != t][0]
                    touch = _contact(boxes[t], boxes[o])
                    if not touch: continue
                    n, sign, clo, chi = touch
                    along = max((k for k in range(3) if k != n), key=lambda k: chi[k] - clo[k])
                    span = chi[along] - clo[along]; spacing = j['spacing_mm'] or span / (j['count'] + 1)
                    for c in range(j['count']):
                        p = [(clo[k] + chi[k]) / 2 for k in range(3)]; p[along] += (c - (j['count'] - 1) / 2) * spacing
                        p[n] = boxes[t]['min'][n] if sign > 0 else boxes[t]['max'][n]
                        if t in offsets: p = [p[k] + offsets[t][k] for k in range(3)]
                        heads.append((p, n, -sign, j['kind']))
            def seen(cam): return sum(1 for _, n, out_sign, _k in heads if cam[n] * out_sign > 0)
            camera_name = max(CAMERAS, key=lambda c: (seen(CAMERAS[c]), c == 'isometric'))
            cam = CAMERAS[camera_name]
            arrows = [a for m in movers for a in _move_arrows(boxes[m], *moves[m], cam, size_mm)]
            context = [solids[i] for i in sorted(placed | set(bases))]
            page = _page()
            ET.SubElement(page, f'{{{NS}}}circle', {'cx': '76', 'cy': '76', 'r': '44', 'fill': 'none', 'stroke': INK, 'stroke-width': '3'})
            _text(page, 76, 99, str(number), 60, '700', 'middle')
            if len(g['copies']) > 1: _text(page, 136, 99, f'{len(g["copies"])}×', 42, '700')
            if step.get('section'): _fit(page, 136, 44, step['section'].strip(), 18, PAGE_W - 166, '700')
            view = _View(context + lifted + arrows, cam, (320, 60, 650, 630), scratch)
            view.layer(page, [solids[i] for i in sorted(placed)], CONTEXT, 1.6)
            view.layer(page, [solids[i] for i in bases if i not in placed], INK, 2.2)
            view.layer(page, lifted + arrows, INK, 2.6)
            # Every scheduled fastener is drawn; one that goes in from a face turned away is dashed.
            hidden_heads = 0
            for p, n, out_sign, kind in heads:
                hidden = cam[n] * out_sign <= 0; hidden_heads += hidden
                tip = view.point(p); q = list(p); q[n] += out_sign * size_mm * 0.07; tail = view.point(q)
                _line(page, tail, tip, 3, dashed=hidden); _head(page, kind, tail[0], tail[1], hidden)
            # Notes sit under the drawing, right of the parts box, so the box can use the full height.
            if hidden_heads: _fit(page, 320, 714, 'Dashed: put in from the other side.', 13, PAGE_W - 350, fill='#333333')
            # A run of more than six identical parts is named once, in the parts box, instead of as a cloud of labels.
            same = {}
            for m in movers: same[defs_of[m]] = same.get(defs_of[m], 0) + 1
            _part_labels(page, [(view.point([(boxes[m]['min'][k] + boxes[m]['max'][k]) / 2 + offsets[m][k] for k in range(3)]), f'P{numbers[m]}')
                                for m in movers if same[defs_of[m]] <= 6])
            fresh = [i for i in parts if i not in placed]
            kinds_here = {}
            for i in fresh or parts: kinds_here.setdefault(defs_of[i], []).append(i)
            parts_box(page, [(len(v), v) for v in kinds_here.values()], hardware, unsized, glue)
            notes = sorted({gap for j in (fasteners or {'joints': []})['joints'] if j['joint_id'] in comp for gap in j['gaps']})
            if notes: _fit(page, 320, 736, 'Rule notes: ' + ', '.join(n.replace('_', ' ') for n in notes) + '. Check before building.', 13, PAGE_W - 350, fill='#333333', smallest=9)
            if len(g['copies']) > 1:
                others = [sorted({i for jid in c for i in joint_ends[jid]}, key=lambda i: numbers[i]) for c in g['copies'][1:]]
                _text(page, 240, 82, 'Build this again with', 15, '400', 'start', '#333333')
                _fit(page, 240, 104, '; '.join(', '.join(f'P{numbers[i]}' for i in o) for o in others), 15, PAGE_W - 270, '700', lines=2, smallest=11)
            save(page, f'guide-{number}', {'kind': 'step', 'step': number, **({'section': step['section'].strip()} if step.get('section') else {}), 'repeat': len(g['copies']), 'joint_ids': sorted(j for c in g['copies'] for j in c),
                                           'new_instance_ids': fresh, 'lifted_instance_ids': movers, 'camera': camera_name,
                                           'fasteners': hardware, 'glue': glue, 'unsized_joint_ids': unsized})
        placed |= {i for jid in step['joint_ids'] for i in joint_ends[jid]}

    if last < len(plan): return {'version': GUIDE_VERSION, 'basis': 'proposed_order', 'drawing_source': drawing_source, 'pages': pages}
    loose = [i for i in ids if i not in placed]
    page = _page(); _text(page, 40, 80, 'Done', 36, '700')
    _View(list(solids.values()), (1, -1, 1), (120, 110, 760, 540), scratch).layer(page, list(solids.values()), INK, 2.2)
    _text(page, 500, 700, f'Total size: width {_number(round(hi[0]-lo[0],1))} × depth {_number(round(hi[1]-lo[1],1))} × height {_number(round(hi[2]-lo[2],1))} mm', 16, '600', 'middle')
    if loose: _fit(page, 500, 726, f'Not in any step: {", ".join(f"P{numbers[i]}" for i in sorted(loose, key=lambda i: numbers[i]))}. Ask Bob where they go.', 14, 920, '400', 'middle', '#333333', smallest=9)
    save(page, f'guide-{number + 1}', {'kind': 'done', 'loose_instance_ids': sorted(loose, key=lambda i: numbers[i])})
    return {'version': GUIDE_VERSION, 'basis': 'proposed_order', 'drawing_source': drawing_source, 'pages': pages}
