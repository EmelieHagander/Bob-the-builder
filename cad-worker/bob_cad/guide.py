"""Build-guide pages (IKEA-style) from the exact saved construction.

A step is a set of saved joints, in an order Bob proposed and the owner can change.
Each page draws the parts already in place in grey, the step's new parts lifted out
of place in black with arrows, and the fasteners the server's fixed rules propose for
those joints. Nothing here invents geometry, order or hardware: unknowns are shown
as unknown. Concept presentation only, like the drawing sheets."""
from __future__ import annotations

import hashlib, itertools, math, shutil, xml.etree.ElementTree as ET
from pathlib import Path
from cairosvg import svg2png
from build123d import Align, Compound, Cone, Cylinder, ExportSVG, Location, Unit
from .annotations import part_name, blank_text, marker_ranges, _number
from .worker import CadContractError, ID, _location, _shape, validate_drawing_source, validate_fasteners, validate_request

NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)
GUIDE_VERSION = 1
MAX_PAGES = 60
_LAYERS = itertools.count()
PAGE_W, PAGE_H = 1000, 750
TOUCH_MM = 0.5
CAMERAS = {'isometric': (1, -1, 1), 'isometric_front_left': (-1, -1, 1),
           'isometric_back_left': (-1, 1, 1), 'isometric_back_right': (1, 1, 1)}
KIND_NAMES = {'screw': 'Screw', 'nail': 'Nail', 'bolt': 'Bolt'}
INK, CONTEXT = '#111111', '#9a9a9a'


def _v(a, b): return [a[k] - b[k] for k in range(3)]
def _dot(a, b): return sum(x * y for x, y in zip(a, b))
def _cross(a, b): return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
def _unit(a):
    n = math.sqrt(_dot(a, a))
    return [x / n for x in a]


def validate_guide(joints, steps, ids):
    """Joints as saved (id, first/second instance ends); steps = ordered lists of joint ids."""
    if not isinstance(joints, list) or len(joints) > 1024: raise CadContractError('guide_joints')
    known = {}
    for j in joints:
        if (not isinstance(j, dict) or not isinstance(j.get('id'), str) or not ID.fullmatch(j['id']) or j['id'] in known
                or any(not isinstance(j.get(end), dict) or j[end].get('instance_id') not in ids for end in ('first', 'second'))
                or j['first']['instance_id'] == j['second']['instance_id']): raise CadContractError('guide_joint')
        known[j['id']] = (j['first']['instance_id'], j['second']['instance_id'])
    if not isinstance(steps, list) or not 1 <= len(steps) <= 200: raise CadContractError('guide_steps')
    used = set()
    for s in steps:
        if (not isinstance(s, dict) or set(s) != {'joint_ids'} or not isinstance(s['joint_ids'], list) or not s['joint_ids']
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


def _page():
    page = ET.Element(f'{{{NS}}}svg', {'width': str(PAGE_W), 'height': str(PAGE_H), 'viewBox': f'0 0 {PAGE_W} {PAGE_H}'})
    ET.SubElement(page, f'{{{NS}}}rect', {'width': str(PAGE_W), 'height': str(PAGE_H), 'fill': '#ffffff'})
    return page


def _text(page, x, y, value, size=16, weight='400', anchor='start', fill=INK):
    el = ET.SubElement(page, f'{{{NS}}}text', {'x': str(x), 'y': str(y), 'font-size': str(size), 'font-weight': weight,
                                               'text-anchor': anchor, 'fill': fill, 'font-family': 'sans-serif'})
    el.text = value


def _line(page, a, b, width=2, colour=INK):
    ET.SubElement(page, f'{{{NS}}}line', {'x1': str(a[0]), 'y1': str(a[1]), 'x2': str(b[0]), 'y2': str(b[1]),
                                          'stroke': colour, 'stroke-width': str(width), 'stroke-linecap': 'round'})


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


def hardware_summary(hardware, glue, unsized, read=True):
    """One line for the box page: what to have ready, without implying missing screws."""
    if not read: return 'not read for this guide'
    items = ([hardware] if hardware else []) + (['glue'] if glue else []) + ([f'{len(unsized)} joint(s) without a rule'] if unsized else [])
    if items == ['glue']: return 'glue only'
    return ' + '.join(items) if items else 'none'


def fastener_rows(joint_ids, schedule):
    """Per-step hardware from the server's rule schedule, never guessed: grouped sized rows,
    glue, and joints without a rule or size (shown with '?')."""
    if schedule is None: return [], [], False
    by = {j['joint_id']: j for j in schedule['joints']}
    groups, unsized, glue = {}, [], False
    for jid in joint_ids:
        j = by.get(jid)
        if j is None or j['source'] == 'no_rule': unsized.append(jid); continue
        if j['kind'] == 'glue': glue = True; continue
        if j['kind'] in KIND_NAMES:
            if None in (j['diameter_mm'], j['length_mm'], j['count']): unsized.append(jid); continue
            key = (j['kind'], j['diameter_mm'], j['length_mm'])
            groups[key] = groups.get(key, 0) + j['count']
    rows = [{'kind': k, 'diameter_mm': d, 'length_mm': l, 'count': c} for (k, d, l), c in sorted(groups.items())]
    return rows, sorted(unsized), glue


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
    """Per step, its sub-assemblies grouped by identical geometry (drawn once, 'N×')."""
    plan = []
    for step in steps:
        groups = []
        for comp in _components(step['joint_ids'], joint_ends):
            sig = _signature(comp, joint_ends, boxes, defs_of)
            for g in groups:
                if g['sig'] == sig: g['copies'].append(comp); break
            else: groups.append({'sig': sig, 'copies': [comp]})
        plan.append((step, groups))
    return plan


def render_guide(raw, joints, steps, output_dir, fasteners=None, context_ids=(), size=(1500, 1125), drawing_source=None, svg_only=False):
    out = Path(output_dir); out.mkdir(parents=True, exist_ok=True)
    scratch = out / '.layers'; scratch.mkdir(exist_ok=True)
    try:
        return _render_guide(raw, joints, steps, out, scratch, fasteners, context_ids, size, drawing_source, svg_only)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def _render_guide(raw, joints, steps, out, scratch, fasteners, context_ids, size, drawing_source, svg_only):
    req = validate_request(raw)
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
    if sum(len(groups) for _, groups in plan) + 2 > MAX_PAGES: raise CadContractError('guide_too_many_pages')
    pages = []

    def label(part_ids):
        return ', '.join(marker_ranges(sorted(numbers[i] for i in part_ids)))

    def save(page, key, note):
        if drawing_source:
            # Every page names the exact construction it was drawn from.
            _text(page, PAGE_W - 30, 26, f'Construction version {drawing_source["revision"]} · ID {drawing_source["artifact_id"]}', 10, '400', 'end', '#555555')
        data = ET.tostring(page, encoding='utf-8', xml_declaration=False)
        (out / f'{key}.svg').write_bytes(data)
        if not svg_only:
            svg2png(bytestring=data, write_to=str(out / f'{key}.png'), output_width=size[0], output_height=size[1], background_color='white')
        pages.append({'key': key, 'sha256': hashlib.sha256(data).hexdigest(), **note})

    def parts_box(page, items, hardware, unsized, glue, y0=140):
        rows = len(items) + len(hardware) + (1 if glue else 0) + (1 if unsized else 0)
        ET.SubElement(page, f'{{{NS}}}rect', {'x': '40', 'y': str(y0), 'width': '250', 'height': str(24 + rows * 84), 'rx': '10',
                                              'fill': 'none', 'stroke': INK, 'stroke-width': '2'})
        y = y0 + 12
        for count, part_ids in items:
            view = _View([solids[part_ids[0]]], (1, -1, 1), (52, y, 80, 72), scratch); view.layer(page, [solids[part_ids[0]]], INK, 1.6)
            _text(page, 146, y + 34, f'{count}×', 26, '700'); _text(page, 146, y + 58, f'{label(part_ids)} {part_name(defs_of[part_ids[0]])}', 13, fill='#333333'); y += 84
        for h in hardware:
            _glyph(page, h['kind'], 60, y); _text(page, 146, y + 34, f'{h["count"]}×', 26, '700')
            _text(page, 146, y + 58, f'{KIND_NAMES[h["kind"]]} {_number(h["diameter_mm"])} × {_number(h["length_mm"])}', 13, fill='#333333'); y += 84
        if glue: _glyph(page, 'glue', 60, y); _text(page, 146, y + 34, 'Glue', 22, '700'); _text(page, 146, y + 58, 'on the joining faces', 13, fill='#333333'); y += 84
        if unsized: _text(page, 60, y + 34, '?', 30, '700'); _text(page, 146, y + 34, 'No rule yet', 16, '700'); _text(page, 146, y + 58, f'{len(unsized)} joint(s): ask Bob', 13, fill='#333333')

    # What is in the box: one tile per part kind, then the whole hardware list.
    page = _page(); _text(page, 40, 70, 'What is in the box', 30, '700')
    kinds = {}
    for iid in sorted(ids, key=lambda i: numbers[i]):
        if iid not in context_ids: kinds.setdefault(defs_of[iid], []).append(iid)
    cols = max(1, min(4, len(kinds))); tile_w = (920 - (cols - 1) * 20) / cols
    for n, (did, members) in enumerate(list(kinds.items())[:8]):
        x = 40 + (n % cols) * (tile_w + 20); y = 100 + (n // cols) * 270
        ET.SubElement(page, f'{{{NS}}}rect', {'x': str(x), 'y': str(y), 'width': str(tile_w), 'height': '250', 'rx': '12', 'fill': 'none', 'stroke': INK, 'stroke-width': '2'})
        _View([solids[members[0]]], (1, -1, 1), (x + 16, y + 14, tile_w - 32, 140), scratch).layer(page, [solids[members[0]]], INK, 1.8)
        _text(page, x + tile_w / 2, y + 190, f'{len(members)}×', 32, '700', 'middle')
        _text(page, x + tile_w / 2, y + 216, f'{label(members)} {part_name(did)}', 15, '600', 'middle')
        _text(page, x + tile_w / 2, y + 238, blank_text(definitions[did]), 12, '400', 'middle', '#333333')
    if len(kinds) > 8: _text(page, 40, 650, f'{len(kinds) - 8} more kinds of part: see Parts and sizes.', 15, fill='#333333')
    all_rows, all_unsized, all_glue = fastener_rows([j['id'] for j in joints], fasteners)
    if len(kinds) <= 4:
        tiles = [(r['kind'], f'{r["count"]}×', f'{KIND_NAMES[r["kind"]]} {_number(r["diameter_mm"])} × {_number(r["length_mm"])}') for r in all_rows]
        if all_glue: tiles.append(('glue', 'Glue', 'on glued joints'))
        for n, (kind, count, words) in enumerate(tiles[:4]):
            x = 40 + n * 235
            ET.SubElement(page, f'{{{NS}}}rect', {'x': str(x), 'y': '400', 'width': '215', 'height': '110', 'rx': '12', 'fill': 'none', 'stroke': INK, 'stroke-width': '2'})
            _glyph(page, kind, x + 8, 416); _text(page, x + 92, 450, count, 28, '700'); _text(page, x + 92, 478, words, 13, '400', 'start', '#333333')
    hw = ', '.join(f'{r["count"]}× {KIND_NAMES[r["kind"]].lower()} {_number(r["diameter_mm"])} × {_number(r["length_mm"])}' for r in all_rows)
    _text(page, 40, 700, 'Fasteners: ' + hardware_summary(hw, all_glue, all_unsized, fasteners is not None), 15, '600')
    _text(page, 40, 724, 'Fastener counts are rule-of-thumb proposals, not a strength check.', 12, fill='#333333')
    save(page, 'guide-0', {'kind': 'parts'})

    placed = set(context_ids)
    number = 0
    for step, groups in plan:
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
                by = {j['joint_id']: j for j in fasteners['joints']}
                for jid in comp:
                    j = by.get(jid)
                    if not j or j['kind'] not in KIND_NAMES or not j['count'] or j['through_instance_id'] not in parts: continue
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
            view = _View(context + lifted + arrows, cam, (320, 60, 650, 630), scratch)
            view.layer(page, [solids[i] for i in sorted(placed)], CONTEXT, 1.6)
            view.layer(page, [solids[i] for i in bases if i not in placed], INK, 2.2)
            view.layer(page, lifted + arrows, INK, 2.6)
            for p, n, out_sign, kind in heads:
                if cam[n] * out_sign <= 0: continue
                tip = view.point(p); q = list(p); q[n] += out_sign * size_mm * 0.07; tail = view.point(q)
                _line(page, tail, tip, 3); ET.SubElement(page, f'{{{NS}}}circle', {'cx': str(tail[0]), 'cy': str(tail[1]), 'r': '5', 'fill': '#ffffff', 'stroke': INK, 'stroke-width': '2'})
            for m in movers:
                b = boxes[m]; mid = [(b['min'][k] + b['max'][k]) / 2 + offsets[m][k] for k in range(3)]; at = view.point(mid)
                _text(page, at[0], at[1] - 10, f'P{numbers[m]}', 15, '700', 'middle')
            fresh = [i for i in parts if i not in placed]
            kinds_here = {}
            for i in fresh or parts: kinds_here.setdefault(defs_of[i], []).append(i)
            parts_box(page, [(len(v), v) for v in kinds_here.values()], hardware, unsized, glue)
            notes = sorted({gap for j in (fasteners or {'joints': []})['joints'] if j['joint_id'] in comp for gap in j['gaps']})
            if notes: _text(page, 40, 724, 'Rule notes: ' + ', '.join(n.replace('_', ' ') for n in notes) + '. Check before building.', 13, '400', 'start', '#333333')
            if len(g['copies']) > 1:
                others = [sorted({i for jid in c for i in joint_ends[jid]}, key=lambda i: numbers[i]) for c in g['copies'][1:]]
                _text(page, 240, 82, 'Build this again with', 15, '400', 'start', '#333333')
                _text(page, 240, 104, '; '.join(', '.join(f'P{numbers[i]}' for i in o) for o in others), 15, '700', 'start')
            save(page, f'guide-{number}', {'kind': 'step', 'step': number, 'repeat': len(g['copies']), 'joint_ids': sorted(j for c in g['copies'] for j in c),
                                           'new_instance_ids': fresh, 'lifted_instance_ids': movers, 'camera': camera_name,
                                           'fasteners': hardware, 'glue': glue, 'unsized_joint_ids': unsized})
        placed |= {i for jid in step['joint_ids'] for i in joint_ends[jid]}

    loose = [i for i in ids if i not in placed]
    page = _page(); _text(page, 40, 80, 'Done', 36, '700')
    _View(list(solids.values()), (1, -1, 1), (120, 110, 760, 540), scratch).layer(page, list(solids.values()), INK, 2.2)
    _text(page, 500, 700, f'Total size: width {_number(round(hi[0]-lo[0],1))} × depth {_number(round(hi[1]-lo[1],1))} × height {_number(round(hi[2]-lo[2],1))} mm', 16, '600', 'middle')
    if loose: _text(page, 500, 726, f'Not in any step: {", ".join(f"P{numbers[i]}" for i in sorted(loose, key=lambda i: numbers[i]))}. Ask Bob where they go.', 14, '400', 'middle', '#333333')
    save(page, f'guide-{number + 1}', {'kind': 'done', 'loose_instance_ids': sorted(loose, key=lambda i: numbers[i])})
    return {'version': GUIDE_VERSION, 'basis': 'proposed_order', 'drawing_source': drawing_source, 'pages': pages}
