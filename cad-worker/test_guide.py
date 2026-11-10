"""Build-guide pages from the exact construction, with the kernel."""
import copy, json, tempfile, unittest
from pathlib import Path
from PIL import Image
import hashlib, os
from unittest.mock import patch
from bob_cad import guide as guide_module
from bob_cad.guide import fastener_rows, glue_name, layout_issues, render_guide, size_text, text_width, tools_needed, _fit, _clear_lift, _head, _lift_direction, _move_arrows
from bob_cad.worker import CadContractError

FIXTURE = json.loads((Path(__file__).parent / 'fixtures/bench_guide.json').read_text())

def bench():
    return copy.deepcopy(FIXTURE)

class GuideTest(unittest.TestCase):
    def test_bench_pages_follow_the_proposed_order_with_repeats_and_rule_fasteners(self):
        f = bench()
        with tempfile.TemporaryDirectory() as tmp:
            guide = render_guide(f['recipe'], f['joints'], f['steps'], tmp, f['fasteners'])
            kinds = [p['kind'] for p in guide['pages']]
            self.assertEqual(kinds, ['parts', 'step', 'step', 'step', 'done'])
            s1, s2, s3 = guide['pages'][1:4]
            # Two identical end frames are drawn once, marked 2x.
            self.assertEqual(s1['repeat'], 2); self.assertEqual(s1['new_instance_ids'], ['end_rail_left', 'leg_bl', 'leg_fl'])
            self.assertEqual(s1['lifted_instance_ids'], ['end_rail_left'])
            self.assertEqual(s1['fasteners'], [{'kind': 'screw', 'diameter_mm': 5, 'length_mm': 120, 'count': 2}])
            self.assertEqual(s2['repeat'], 2); self.assertEqual(s2['new_instance_ids'], ['rail_front'])
            self.assertEqual(s3['repeat'], 1); self.assertEqual(s3['fasteners'], [{'kind': 'screw', 'diameter_mm': 4.5, 'length_mm': 60, 'count': 30}])
            self.assertEqual(guide['pages'][-1]['loose_instance_ids'], [])
            for page in guide['pages']:
                with Image.open(Path(tmp, page['key'] + '.png')) as image:
                    self.assertEqual(image.size, (1500, 1125))
                    self.assertGreater(sum(image.convert('L').histogram()[:200]), 500, 'every page draws something')
                self.assertTrue(Path(tmp, page['key'] + '.svg').read_bytes().startswith(b'<svg'))
            svg = Path(tmp, 'guide-3.svg').read_text()
            self.assertIn('30×', svg); self.assertIn('Screw 4.5 × 60', svg); self.assertIn('Rule notes: short penetration', svg)
            box = Path(tmp, 'guide-0.svg').read_text()
            for words in ('>30×<', '>Screw 4.5 × 60<', '>8×<', '>Screw 5 × 120<', '>Drill driver with bits<'): self.assertIn(words, box)
            for page in guide['pages']: self.assertEqual(layout_issues(Path(tmp, page['key'] + '.svg').read_bytes()), [], page['key'])
            # Every fastener in a step's box is drawn on the page (one more head is the box's own symbol);
            # one that goes in from a face turned away is dashed, with a note.
            for page in (s1, s2, s3):
                svg = Path(tmp, page['key'] + '.svg').read_text()
                drawn = svg.count('data-head="screw') - len(page['fasteners'])
                self.assertEqual(drawn, sum(h['count'] for h in page['fasteners']), page['key'])
                self.assertEqual('data-head="screw hidden"' in svg, 'Dashed: put in from the other side.' in svg)
            self.assertIn('data-head="screw hidden"', Path(tmp, 'guide-2.svg').read_text(), 'step 2: one screw from the far side')

    def test_new_parts_lift_away_from_what_they_join_never_into_it(self):
        boxes = {'leg_a': {'min': [0, 0, 0], 'max': [45, 45, 430]}, 'leg_b': {'min': [0, 315, 0], 'max': [45, 360, 430]},
                 'rail': {'min': [0, 45, 385], 'max': [45, 315, 430]}, 'board': {'min': [0, 0, 430], 'max': [1200, 120, 458]}}
        # A rail between two legs cannot slide along them: it comes down from above.
        self.assertEqual(_lift_direction('rail', ['leg_a', 'leg_b'], boxes, [600, 180, 229]), (2, 1))
        self.assertEqual(_lift_direction('board', ['rail'], boxes, [600, 180, 229]), (2, 1))
        side = {'post': {'min': [0, 0, 0], 'max': [45, 45, 900]}, 'brace': {'min': [45, 0, 300], 'max': [600, 45, 345]},
                'beam': {'min': [0, 0, 345], 'max': [600, 45, 400]}}
        # Pinned from above and the side: it leaves through a free side, not into the beam.
        self.assertNotIn(_lift_direction('brace', ['post', 'beam'], side, [300, 22, 450]), [(2, 1), (0, -1)])

    def test_a_part_going_into_a_box_is_drawn_above_it_with_arrows_into_it(self):
        # The live box (2026-11-01): a 476 x 276 bottom between four 250 mm walls.
        walls = {'front': {'min': [12, 0, 0], 'max': [488, 12, 250]}, 'back': {'min': [12, 288, 0], 'max': [488, 300, 250]},
                 'left': {'min': [0, 0, 0], 'max': [12, 300, 250]}, 'right': {'min': [488, 0, 0], 'max': [500, 300, 250]}}
        bottom = {'min': [12, 12, 0], 'max': [488, 288, 12]}
        boxes = {**walls, 'bottom': bottom}
        lift = _clear_lift('bottom', 2, 1, boxes, list(walls), 120, 40)
        self.assertGreaterEqual(bottom['min'][2] + lift, 250 + 40, 'clear of the walls, not floating inside the box')
        # A part beside the frame keeps the normal lift.
        self.assertEqual(_clear_lift('side', 0, 1, {**walls, 'side': {'min': [500, 0, 0], 'max': [512, 300, 250]}}, list(walls), 120, 40), 120)
        arrows = _move_arrows(bottom, 2, 1, lift, (1, -1, 1), 600)
        for a in arrows:
            bb = a.bounding_box()
            self.assertTrue(12 < bb.min.Y < 288 and bb.max.Z <= lift, 'inside the footprint, between the lifted part and its place')

    def test_each_fastener_kind_has_its_own_head_and_hidden_ones_are_dashed(self):
        import xml.etree.ElementTree as ET
        page = ET.Element('svg')
        for kind, hidden in (('screw', False), ('nail', False), ('bolt', False), ('screw', True)): _head(page, kind, 10, 10, hidden)
        screw, nail, bolt, back = list(page)
        self.assertEqual([c.tag.split('}')[-1] for c in screw], ['circle', 'path'], 'screw: cross head')
        self.assertNotEqual(nail[0].get('fill'), '#ffffff', 'nail: solid dot')
        self.assertEqual(bolt[0].tag.split('}')[-1], 'polygon', 'bolt: hexagon')
        self.assertEqual(len(bolt[0].get('points').split()), 6)
        self.assertTrue(back.get('stroke-dasharray'), 'from the far side: dashed')

    def test_sizes_show_only_what_is_known_never_a_question_mark(self):
        self.assertEqual(size_text(5, 120), ' 5 × 120')
        self.assertEqual(size_text(None, 50), ' 50 mm')
        self.assertEqual(size_text(10, None), ' Ø 10 mm')
        self.assertEqual(size_text(None, None), '')

    def test_tools_follow_the_scheduled_hardware(self):
        row = lambda kind, d=None, l=None: {'kind': kind, 'diameter_mm': d, 'length_mm': l, 'count': 1}
        self.assertEqual(tools_needed([], False), ['Tape measure', 'Pencil', 'Try square', 'Saw'])
        self.assertEqual(tools_needed([row('nail', 2.8, 50)], False)[4:], ['Hammer or mallet'])
        tools = tools_needed([row('screw', 5, 70), row('bolt', 8, 140), row('dowel', 10, 60), row('bracket', None, 50)], True)
        self.assertEqual(tools[4:], ['Drill driver with bits', 'Drill bit Ø 10 mm (dowel holes)', 'Drill bit Ø 8 mm (bolt holes)',
                                     'Spanner or hex key for the bolts', 'Hammer or mallet', 'Clamps', 'Damp cloth for glue'])

    def test_the_visual_check_finds_overlaps_cut_off_text_and_text_across_a_frame(self):
        page = guide_module._page()
        guide_module._text(page, 40, 100, 'P27', 15, '700'); guide_module._text(page, 44, 104, 'P5', 15, '700')
        guide_module._text(page, 40, 700, 'Fasteners: ' + '20× angle bracket, ' * 12, 15, '600')
        import xml.etree.ElementTree as ET
        ET.SubElement(page, '{http://www.w3.org/2000/svg}rect', {'x': '40', 'y': '300', 'width': '100', 'height': '50', 'fill': 'none'})
        guide_module._text(page, 60, 330, 'P15-P16 Guard lower removable', 15)
        issues = layout_issues(page)
        self.assertTrue(any('"P27" overlaps "P5"' in i for i in issues), issues)
        self.assertTrue(any('leaves the page' in i for i in issues), issues)
        self.assertTrue(any('crosses a frame' in i for i in issues), issues)
        # The same words drawn with _fit stay inside their space.
        clean = guide_module._page()
        ET.SubElement(clean, '{http://www.w3.org/2000/svg}rect', {'x': '40', 'y': '300', 'width': '100', 'height': '50', 'fill': 'none'})
        _fit(clean, 46, 318, 'P15-P16 Guard lower removable', 15, 88, lines=2)
        _fit(clean, 40, 700, 'Fasteners: ' + '20× angle bracket, ' * 12, 15, 920)
        self.assertEqual(layout_issues(clean), [])
        self.assertGreater(text_width('Guard', 15, '700'), text_width('Guard', 15))

    def test_the_live_bunk_bed_guide_passes_the_visual_check_and_lists_everything(self):
        # Våningssäng 2, construction version 27 with Bob's seven sections (2026-11-10): the guide
        # whose step box ran off the page, labels overlapped and hardware line was cut off.
        f = json.loads((Path(__file__).parent / 'fixtures/bunk_bed_guide.json').read_text())
        with tempfile.TemporaryDirectory() as tmp:
            guide = render_guide(f['recipe'], f['joints'], f['steps'], tmp, f['fasteners'], f['context_ids'], svg_only=True,
                                 drawing_source=SOURCE, item_names=f['item_names'])
            self.assertEqual(len(guide['pages']), 9)
            for page in guide['pages']:
                self.assertEqual(layout_issues(Path(tmp, page['key'] + '.svg').read_bytes()), [], page['key'])
                self.assertNotIn('layout_defects', page)
            box = Path(tmp, 'guide-0.svg').read_text()
            self.assertNotIn('?', box); self.assertNotIn('more kinds of part', box)
            self.assertEqual(box.count('mm, length'), 13, 'every kind of part has its tile')
            # Words may wrap, so compare the page's text as one string.
            import re, xml.etree.ElementTree as ET
            words = ' '.join(el.text for el in ET.fromstring(box).iter('{http://www.w3.org/2000/svg}text'))
            for name in f['item_names'].values(): self.assertIn(re.sub(r'\s+', ' ', name), words)
            for word in ('Hardware', 'Tools', 'Tape measure', 'Drill bit Ø 8 mm (bolt holes)', 'Clamps'): self.assertIn(word, words)
            self.assertGreater(float(ET.fromstring(box).get('height')), 750, 'the page grows instead of leaving items out')
            # A run of 28 slats is named once in the box, not as 28 labels over the drawing.
            self.assertNotIn('>P40<', Path(tmp, 'guide-5.svg').read_text())
            self.assertIn('>P27<', Path(tmp, 'guide-1.svg').read_text())

    def test_chosen_items_keep_their_catalog_names_and_bad_names_are_refused(self):
        f = bench()
        row = {'joint_id': 'g', 'source': 'chosen', 'kind': 'glue', 'material_id': 'm', 'material_revision': 2}
        self.assertEqual(glue_name(['g'], {'joints': [row]}, {'m@2': 'Trälim, inomhus'}), 'Trälim, inomhus')
        self.assertIsNone(glue_name(['g'], {'joints': [row]}, None))
        with tempfile.TemporaryDirectory() as tmp:
            for bad in ([], {'x': 'Name'}, {'aa@1': ''}, {'aa@1': 5}):
                with self.assertRaisesRegex(CadContractError, 'guide_item_names'):
                    render_guide(f['recipe'], f['joints'], f['steps'], tmp, f['fasteners'], item_names=bad)

    def test_hardware_is_never_guessed(self):
        sched = {'joints': [
            {'joint_id': 'a', 'source': 'rule', 'kind': 'screw', 'diameter_mm': 5.0, 'length_mm': 70, 'count': 2, 'gaps': []},
            {'joint_id': 'b', 'source': 'override', 'kind': 'nail', 'diameter_mm': 2.8, 'length_mm': 50, 'count': 6, 'gaps': []},
            {'joint_id': 'c', 'source': 'rule', 'kind': 'glue', 'diameter_mm': None, 'length_mm': None, 'count': None, 'gaps': []},
            {'joint_id': 'd', 'source': 'no_rule', 'kind': None, 'diameter_mm': None, 'length_mm': None, 'count': None, 'gaps': ['no_rule_for_method']},
            {'joint_id': 'e', 'source': 'rule', 'kind': 'screw', 'diameter_mm': None, 'length_mm': 70, 'count': 2, 'gaps': []}]}
        rows, unsized, glue = fastener_rows(['a', 'b', 'c', 'd', 'e', 'missing'], sched)
        self.assertEqual(rows, [{'kind': 'nail', 'diameter_mm': 2.8, 'length_mm': 50, 'count': 6},
                                {'kind': 'screw', 'diameter_mm': 5.0, 'length_mm': 70, 'count': 2}])
        self.assertEqual(unsized, ['d', 'e', 'missing']); self.assertTrue(glue)
        self.assertEqual(fastener_rows(['a'], None), ([], [], False), 'no schedule read: nothing claimed')

    def test_chosen_items_group_by_kind_and_size_with_glue_packages_and_open_joints(self):
        # 2026-11-01: one row per chosen item; added kinds count along the contact,
        # per joint, or once per construction.
        def row(jid, kind, d, l, n, counting, source='chosen'):
            return {'joint_id': jid, 'source': source, 'kind': kind, 'diameter_mm': d, 'length_mm': l, 'count': n, 'counting': counting, 'gaps': []}
        sched = {'joints': [row('a', 'screw', 3.5, 30, 3, 'along_contact'), row('a', 'glue', None, None, None, 'per_construction'),
                            row('b', 'dowel', 8, 40, 3, 'along_contact'), row('c', 'bracket', None, None, 2, 'per_joint'),
                            row('d', 'bracket', None, None, None, 'per_joint'), row('e', 'adhesive', None, None, None, 'per_construction'),
                            row('f', None, None, None, None, None, 'none'), row('g', None, None, None, None, None)]}
        rows, unsized, glue = fastener_rows(['a', 'b', 'c', 'd', 'e', 'f', 'g'], sched)
        self.assertEqual(rows, [{'kind': 'adhesive', 'diameter_mm': None, 'length_mm': None, 'count': 1},
                                {'kind': 'bracket', 'diameter_mm': None, 'length_mm': None, 'count': 2},
                                {'kind': 'dowel', 'diameter_mm': 8, 'length_mm': 40, 'count': 3},
                                {'kind': 'screw', 'diameter_mm': 3.5, 'length_mm': 30, 'count': 3}])
        self.assertEqual(unsized, ['d', 'f', 'g']); self.assertTrue(glue)

    def test_the_schedule_check_accepts_chosen_item_rows_as_the_database_sends_them(self):
        from bob_cad.worker import validate_fasteners
        base = {'method': 'butt', 'diameter_mm': None, 'length_mm': None, 'count': None, 'spacing_mm': None, 'through_instance_id': 'left',
                'through_mm': 12, 'embed_mm': 276, 'contact_length_mm': 250, 'contact_width_mm': 12, 'proposal': None, 'gaps': []}
        item = {'counting': 'along_contact', 'material_id': '00000000-0000-4000-8000-0000000000a1', 'material_revision': 1}
        joints = [{**base, **item, 'joint_id': 'a', 'source': 'chosen', 'kind': 'screw', 'diameter_mm': 3.5, 'length_mm': 30, 'count': 3, 'spacing_mm': 108},
                  {**base, 'joint_id': 'a', 'source': 'chosen', 'kind': 'glue', 'counting': 'per_construction', 'material_id': item['material_id'][:-1] + '2', 'material_revision': 1},
                  {**base, 'joint_id': 'b', 'source': 'none', 'kind': None, 'counting': None, 'material_id': None, 'material_revision': None, 'gaps': ['no_fastener_chosen']},
                  {**base, 'joint_id': 'c', 'source': 'existing', 'kind': None, 'counting': None, 'material_id': None, 'material_revision': None, 'through_instance_id': None},
                  {**base, 'joint_id': 'd', 'source': 'chosen', 'kind': 'bracket', 'counting': 'per_joint', 'material_id': item['material_id'], 'material_revision': 2, 'count': 2}]
        totals = [{'kind': 'screw', 'diameter_mm': 3.5, 'length_mm': 30, 'count': 3, 'joint_ids': ['a']},
                  {'kind': 'bracket', 'diameter_mm': None, 'length_mm': None, 'count': 2, 'joint_ids': ['d']}]
        sched = {'rule_version': 'fastener-rules-v1', 'complete': False, 'glue_packages': 1, 'joints': joints, 'totals': totals}
        self.assertIs(validate_fasteners(sched), sched)
        # A rule row cannot repeat a joint; every chosen-joint row carries the item fields; kinds are one lowercase word.
        rule = {**base, 'joint_id': 'a', 'method': 'screwed_butt', 'source': 'rule', 'kind': 'screw'}
        for bad in (rule, {k: v for k, v in joints[2].items() if k != 'counting'}, {**joints[0], 'kind': 'Skruv!'}):
            with self.assertRaises(CadContractError): validate_fasteners({**sched, 'joints': joints + [bad]})
        old = {**base, 'joint_id': 'x', 'method': 'screwed_butt', 'source': 'rule', 'kind': 'dowel'}
        with self.assertRaises(CadContractError): validate_fasteners({**sched, 'joints': [old], 'totals': []})
        with self.assertRaises(CadContractError): validate_fasteners({**sched, 'totals': [{**totals[0], 'diameter_mm': None}]})

    def test_parts_left_out_of_every_step_are_named_on_the_done_page(self):
        f = bench(); f['steps'] = f['steps'][:2]
        with tempfile.TemporaryDirectory() as tmp:
            guide = render_guide(f['recipe'], f['joints'], f['steps'], tmp, f['fasteners'])
            self.assertEqual(guide['pages'][-1]['loose_instance_ids'], ['seat_board_1', 'seat_board_2', 'seat_board_3'])
            self.assertIn('Ask Bob where they go', Path(tmp, guide['pages'][-1]['key'] + '.svg').read_text())

    def test_invalid_orders_and_joints_are_refused(self):
        f = bench()
        cases = [
            ({**f, 'steps': [{'joint_ids': ['left_front']}, {'joint_ids': ['left_front']}]}, 'guide_step'),
            ({**f, 'steps': [{'joint_ids': ['nope']}]}, 'guide_step'),
            ({**f, 'steps': []}, 'guide_steps'),
            ({**f, 'joints': f['joints'] + [{'id': 'ghost', 'first': {'instance_id': 'leg_fl'}, 'second': {'instance_id': 'missing'}}]}, 'guide_joint'),
        ]
        for case, code in cases:
            with self.subTest(code=code), tempfile.TemporaryDirectory() as tmp:
                with self.assertRaisesRegex(CadContractError, code):
                    render_guide(case['recipe'], case['joints'], case['steps'], tmp, case['fasteners'])

SOURCE = {'artifact_id': '11111111-1111-4111-8111-111111111111', 'revision': 4}

class GuideServiceTest(unittest.TestCase):
    def test_svg_only_pages_are_hashed_pinned_and_leave_no_working_files(self):
        f = bench()
        with tempfile.TemporaryDirectory() as tmp:
            guide = render_guide(f['recipe'], f['joints'], f['steps'], tmp, f['fasteners'], drawing_source=SOURCE, svg_only=True)
            self.assertEqual(guide['drawing_source'], SOURCE)
            self.assertEqual(sorted(os.listdir(tmp)), sorted(p['key'] + '.svg' for p in guide['pages']), 'no PNGs and no working layers')
            for page in guide['pages']:
                data = Path(tmp, page['key'] + '.svg').read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), page['sha256'])
                self.assertIn('Construction version 4 · ID 11111111-1111-4111-8111-111111111111', data.decode())

    def test_one_page_per_step_even_when_a_step_joins_different_things(self):
        # 2026-11-09: the page count is the step count Bob chose, never the geometry.
        f = bench()
        every = sorted(j for step in f['steps'] for j in step['joint_ids'])
        with tempfile.TemporaryDirectory() as tmp:
            guide = render_guide(f['recipe'], f['joints'], [{'joint_ids': every}], tmp, f['fasteners'], svg_only=True)
            self.assertEqual([p['kind'] for p in guide['pages']], ['parts', 'step', 'done'])
            self.assertEqual(guide['pages'][1]['joint_ids'], every)
            self.assertEqual(guide['pages'][1]['repeat'], 1)

    def test_a_step_prints_its_section_title(self):
        f = bench()
        steps = [{**step, 'section': 'End frames' if n == 0 else 'Rails'} for n, step in enumerate(f['steps'])]
        with tempfile.TemporaryDirectory() as tmp:
            guide = render_guide(f['recipe'], f['joints'], steps, tmp, f['fasteners'], svg_only=True)
            self.assertEqual([p.get('section') for p in guide['pages']], [None, 'End frames', 'Rails', 'Rails', None])
            self.assertIn('End frames', Path(tmp, 'guide-1.svg').read_text())
        for bad in ('', ' ', 'x' * 81, 3):
            with self.subTest(section=bad), tempfile.TemporaryDirectory() as tmp, self.assertRaisesRegex(CadContractError, 'guide_step'):
                render_guide(f['recipe'], f['joints'], [{**f['steps'][0], 'section': bad}] + f['steps'][1:], tmp, f['fasteners'])

    def test_ranges_draw_the_same_pages_as_one_call(self):
        # 2026-11-09: long guides are drawn a section at a time with global page numbers.
        f = bench()
        with tempfile.TemporaryDirectory() as whole, tempfile.TemporaryDirectory() as parts:
            one = render_guide(f['recipe'], f['joints'], f['steps'], whole, f['fasteners'], svg_only=True)
            pieces = [render_guide(f['recipe'], f['joints'], f['steps'], parts, f['fasteners'], svg_only=True, step_range=r)['pages'] for r in ([0, 1], [1, 3])]
            self.assertEqual([p['key'] for p in pieces[0]], ['guide-0', 'guide-1'])
            self.assertEqual([p['key'] for p in pieces[1]], ['guide-2', 'guide-3', 'guide-4'])
            self.assertEqual([p['sha256'] for p in pieces[0] + pieces[1]], [p['sha256'] for p in one['pages']], 'identical bytes')
            for bad in ([1, 1], [0, 4], [-1, 2], [0], 'x', [0, True]):
                with self.subTest(range=bad), self.assertRaisesRegex(CadContractError, 'guide_range'):
                    render_guide(f['recipe'], f['joints'], f['steps'], parts, f['fasteners'], svg_only=True, step_range=bad)

    def test_the_guide_route_names_its_refusal(self):
        import json, threading, urllib.request, urllib.error
        from http.server import HTTPServer
        from bob_cad.server import Handler
        f = bench()
        envelope = {'recipe': f['recipe'], 'drawing_source': SOURCE, 'joints': f['joints'], 'steps': [], 'fasteners': f['fasteners'], 'context_ids': []}
        with patch.dict(os.environ, {'BOB_CAD_TOKEN': 'fixture-token-' + 'x' * 32}):
            server = HTTPServer(('127.0.0.1', 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            auth = {'Authorization': 'Bearer ' + os.environ['BOB_CAD_TOKEN'], 'Content-Type': 'application/json'}
            try:
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{server.server_port}/guide', data=json.dumps(envelope).encode(), method='POST', headers=auth), timeout=45)
                self.assertEqual(error.exception.code, 422)
                self.assertEqual(json.loads(error.exception.read()), {'error': 'guide_steps'})
            finally:
                server.shutdown(); server.server_close(); thread.join(timeout=5)

    def test_page_cap_and_construction_pin_are_enforced(self):
        f = bench()
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(guide_module, 'MAX_PAGES', 4), self.assertRaisesRegex(CadContractError, 'guide_too_many_pages'):
                render_guide(f['recipe'], f['joints'], f['steps'], tmp, f['fasteners'])
            with self.assertRaisesRegex(CadContractError, 'drawing_source'):
                render_guide(f['recipe'], f['joints'], f['steps'], tmp, f['fasteners'], drawing_source={'artifact_id': 'x', 'revision': 1})

    def test_authenticated_guide_route_returns_hashed_svg_pages(self):
        import base64, json, threading, urllib.request, urllib.error
        from http.server import HTTPServer
        from bob_cad.server import Handler
        f = bench()
        envelope = {'recipe': f['recipe'], 'drawing_source': SOURCE, 'joints': f['joints'], 'steps': f['steps'],
                    'fasteners': f['fasteners'], 'context_ids': []}
        with patch.dict(os.environ, {'BOB_CAD_TOKEN': 'fixture-token-' + 'x' * 32}):
            server = HTTPServer(('127.0.0.1', 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            endpoint = f'http://127.0.0.1:{server.server_port}/guide'
            auth = {'Authorization': 'Bearer ' + os.environ['BOB_CAD_TOKEN'], 'Content-Type': 'application/json'}
            try:
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(urllib.request.Request(endpoint, data=b'{}', method='POST'), timeout=5)
                self.assertEqual(error.exception.code, 401)
                with urllib.request.urlopen(urllib.request.Request(endpoint, data=json.dumps(envelope).encode(), method='POST', headers=auth), timeout=45) as response:
                    packet = json.load(response)
                self.assertEqual(set(packet['files']), {f'guide-{n}' for n in range(5)})
                self.assertEqual(packet['guide']['drawing_source'], SOURCE)
                for page in packet['guide']['pages']:
                    raw = base64.b64decode(packet['files'][page['key']])
                    self.assertTrue(raw.startswith(b'<svg')); self.assertEqual(hashlib.sha256(raw).hexdigest(), page['sha256'])
                for broken in ({k: v for k, v in envelope.items() if k != 'context_ids'}, {**envelope, 'drawing_source': None}, {**envelope, 'extra': 1}):
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        urllib.request.urlopen(urllib.request.Request(endpoint, data=json.dumps(broken).encode(), method='POST', headers=auth), timeout=45)
                    self.assertEqual(error.exception.code, 422)
            finally:
                server.shutdown(); server.server_close(); thread.join(timeout=5)

if __name__ == '__main__': unittest.main()
