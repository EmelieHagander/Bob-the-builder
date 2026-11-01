"""Build-guide pages from the exact construction, with the kernel."""
import copy, json, tempfile, unittest
from pathlib import Path
from PIL import Image
import hashlib, os
from unittest.mock import patch
from bob_cad import guide as guide_module
from bob_cad.guide import fastener_rows, hardware_summary, render_guide, _clear_lift, _head, _lift_direction, _move_arrows
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
            self.assertIn('Fasteners: 30× screw 4.5 × 60, 8× screw 5 × 120', Path(tmp, 'guide-0.svg').read_text())
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

    def test_the_box_page_says_glue_only_instead_of_missing_screws(self):
        self.assertEqual(hardware_summary('', True, []), 'glue only')
        self.assertEqual(hardware_summary('8× screw 4 × 40', True, []), '8× screw 4 × 40 + glue')
        self.assertEqual(hardware_summary('', False, ['j1']), '1 joint(s) without a rule')
        self.assertEqual(hardware_summary('', False, []), 'none')
        self.assertEqual(hardware_summary('', True, [], read=False), 'not read for this guide')

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
