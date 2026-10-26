import tempfile, unittest
from pathlib import Path
from bob_cad.worker import CadContractError, render_assembly, validate_request, _shape, _checks, _render_preview, _camera, VIEWS, MAX_VIEWS
from PIL import Image
from unittest.mock import patch
import math, hashlib, struct

def fixture():
    return {
        "contract_version":1,"units":"mm","assembly_id":"assembly.demo",
        "definitions":[
            {"id":"post","primitive":"box","material_ref":"mat.45x70","x_mm":45,"y_mm":70,"z_mm":1600},
            {"id":"rail","primitive":"box","material_ref":"mat.45x70","x_mm":900,"y_mm":45,"z_mm":70},
            {"id":"pipe","primitive":"tube","material_ref":"mat.pvc","outside_diameter_mm":32,"wall_thickness_mm":2,"length_mm":500}
        ],
        "instances":[
            {"id":"post.left","definition_id":"post","placement":{"x":0,"y":0,"z":0,"rx":0,"ry":0,"rz":0}},
            {"id":"post.right","definition_id":"post","placement":{"x":955,"y":0,"z":0,"rx":0,"ry":0,"rz":0}},
            {"id":"rail.top","definition_id":"rail","placement":{"x":50,"y":12.5,"z":1450,"rx":0,"ry":0,"rz":0}},
            {"id":"pipe.test","definition_id":"pipe","placement":{"x":500,"y":150,"z":0,"rx":0,"ry":0,"rz":0}}
        ],
        "views":["front","right","top","isometric"]
    }

class CadWorkerTest(unittest.TestCase):
    def test_larger_models_keep_all_parts_and_full_size_sheet_previews(self):
        import xml.etree.ElementTree as ET
        for count in (25,128):
            r=fixture();r['views']=['front']
            r['definitions']=[{'id':'block','primitive':'box','material_ref':None,'x_mm':10,'y_mm':20,'z_mm':30}]
            r['instances']=[{'id':f'part{i:03}','definition_id':'block','placement':{'x':(i%16)*20,'y':0,'z':(i//16)*50,'rx':0,'ry':0,'rz':0}} for i in range(count)]
            with self.subTest(count=count),tempfile.TemporaryDirectory() as tmp:
                result=render_assembly(r,tmp,{'artifact_id':'11111111-1111-4111-8111-111111111111','revision':7})
                self.assertEqual(result['annotations']['coverage'],'complete')
                self.assertEqual(len(result['annotations']['views']['front']['parts']),count)
                keys=['front']+[f'front.sheet{i}' for i in range(2,math.ceil(count/32)+1)]
                self.assertEqual(list(result['previews']),keys)
                svg=Path(tmp,'front.svg').read_bytes()
                for key in keys:
                    self.assertEqual(result['previews'][key]['source_sha256'],hashlib.sha256(svg).hexdigest())
                    with Image.open(Path(tmp,key+'.png')) as image:
                        self.assertEqual(max(image.size),1024)
                        self.assertGreater(sum(image.convert('L').histogram()[:200]),100)
                    self.assertEqual(result['previews'][key]['sha256'],hashlib.sha256(Path(tmp,key+'.png').read_bytes()).hexdigest())
                # Persist reviewable synthetic pages in CI; no owner data.
                import os, shutil
                if os.environ.get('CI'):
                    output=Path('test-results/cad');output.mkdir(parents=True,exist_ok=True)
                    for key in keys: shutil.copy(Path(tmp,key+'.png'),output/f'{count}-{key}.png')
                    shutil.copy(Path(tmp,'front.svg'),output/f'{count}-front.svg')

    def test_every_side_and_upper_corner_can_be_drawn(self):
        # 2026-10-21: a left-gable requirement was invisible in front/right/top/isometric.
        self.assertEqual(set(VIEWS),{"front","back","left","right","top","bottom","isometric","isometric_front_left","isometric_back_left","isometric_back_right"})
        center,d=(10,20,30),100
        expected={"front":(0,-1,0),"back":(0,1,0),"left":(-1,0,0),"right":(1,0,0),"top":(0,0,1),"bottom":(0,0,-1),
                  "isometric":(1,-1,1),"isometric_front_left":(-1,-1,1),"isometric_back_left":(-1,1,1),"isometric_back_right":(1,1,1)}
        for view,direction in expected.items():
            origin,up=_camera(view,center,d)
            self.assertEqual(tuple((o-c)/d for o,c in zip(origin,center)),direction,view)
            self.assertNotEqual(tuple(abs(u) for u in up),tuple(abs(x) for x in direction),view)
        r=fixture();r["views"]=["front","back","left","right","top","bottom"];self.assertEqual(validate_request(r)["views"],r["views"])
        r=fixture();r["views"]=list(VIEWS)[:MAX_VIEWS+1]
        with self.assertRaises(CadContractError): validate_request(r)
        r=fixture();r["views"]=["side"]
        with self.assertRaises(CadContractError): validate_request(r)

    def test_left_back_and_bottom_views_render_dimensioned_sheets(self):
        r=fixture();r["views"]=["left","back","bottom","isometric_back_left"]
        with tempfile.TemporaryDirectory() as tmp:
            result=render_assembly(r,tmp)
            self.assertEqual(set(result['exports']),{"step","left","back","bottom","isometric_back_left"})
            for view,axes in {"left":[1,2],"back":[0,2],"bottom":[0,1],"isometric_back_left":[]}.items():
                notes=result['annotations']['views'][view]
                self.assertEqual(notes['dimensions'],[{'axis':'xyz'[i],'mm':result['bounding_box_mm']['size'][i]} for i in axes])
                self.assertEqual(hashlib.sha256(Path(tmp,view+'.png').read_bytes()).hexdigest(),result['previews'][view]['sha256'])

    def test_annotated_views_identify_exact_instances_and_dimensions_before_hashing(self):
        import xml.etree.ElementTree as ET
        r=fixture()
        # Stable IDs can retain an earlier dimension after a source revision.
        r['assembly_id']='retained_assembly_600_800_300'
        with tempfile.TemporaryDirectory() as tmp:
            source={'artifact_id':'11111111-1111-4111-8111-111111111111','revision':3}
            result=render_assembly(r,tmp,source)
            self.assertEqual(result['assembly_id'],r['assembly_id'])
            self.assertEqual(result['drawing_source'],source)
            self.assertEqual(result['annotations']['coverage'],'complete')
            for view in r['views']:
                notes=result['annotations']['views'][view]
                self.assertEqual([p['instance_id'] for p in notes['parts']],sorted(i['id'] for i in r['instances']))
                expected={'front':[0,2],'right':[1,2],'top':[0,1],'isometric':[]}[view]
                self.assertEqual(notes['dimensions'],[{'axis':'xyz'[i],'mm':result['bounding_box_mm']['size'][i]} for i in expected])
                root=ET.parse(Path(tmp,view+'.svg')).getroot()
                texts=[e.text for e in root.iter() if e.tag.endswith('}text')]
                self.assertIn('Assembly / '+view,texts)
                self.assertFalse(any(r['assembly_id'] in s for s in texts))
                self.assertTrue(any('Dimensions in mm' in s for s in texts))
                self.assertTrue(any('P1' in s for s in texts))
                self.assertTrue(any('revision 3' in s for s in texts))
                self.assertEqual(hashlib.sha256(Path(tmp,view+'.svg').read_bytes()).hexdigest(),result['previews'][view]['source_sha256'])
                self.assertEqual(hashlib.sha256(Path(tmp,view+'.png').read_bytes()).hexdigest(),result['previews'][view]['sha256'])

    def test_room_and_detail_scale_previews_have_visible_lines(self):
        for size in (10,3970,100000):
            r=fixture()
            r['definitions']=[{'id':'room','primitive':'box','material_ref':None,'x_mm':size,'y_mm':size*.7,'z_mm':size*.5}]
            r['instances']=[{'id':'room','definition_id':'room','placement':{'x':0,'y':0,'z':0,'rx':0,'ry':0,'rz':0}}]
            with tempfile.TemporaryDirectory() as tmp:
                result=render_assembly(r,tmp)
                self.assertAlmostEqual(result['bounding_box_mm']['size'][0],size)
                for view in r['views']:
                    with Image.open(Path(tmp,view+'.png')) as image:
                        self.assertGreater(sum(image.convert('L').histogram()[:200]),100,view)
                    self.assertEqual(hashlib.sha256(Path(tmp,view+'.svg').read_bytes()).hexdigest(),result['previews'][view]['source_sha256'])

    def test_blank_preview_is_a_renderer_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            svg=Path(tmp,'blank.svg');svg.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4000 2700"/>')
            with self.assertRaisesRegex(CadContractError,'preview_unreadable'):
                _render_preview(svg,Path(tmp,'blank.png'))

    def test_real_hole_and_notch_preserve_blank_but_remove_exact_volume(self):
        d={"id":"block","primitive":"box","material_ref":None,"x_mm":100,"y_mm":100,"z_mm":20,"cuts":[
            {"primitive":"cylinder","diameter_mm":10,"length_mm":22,"placement":{"x":50,"y":50,"z":-1,"rx":0,"ry":0,"rz":0}},
            {"primitive":"box","x_mm":10,"y_mm":20,"z_mm":22,"placement":{"x":0,"y":0,"z":-1,"rx":0,"ry":0,"rz":0}}]}
        self.assertAlmostEqual(_shape(d).volume,200000-math.pi*25*20-4000,places=4)
        d["cuts"][0]["placement"]["x"]=500
        with self.assertRaisesRegex(CadContractError,"does_not_intersect"): _shape(d)

    def test_collision_clearance_and_travel_envelope_are_reported(self):
        r=fixture();r["views"]=["front"]
        r["definitions"]=[{"id":"block","primitive":"box","material_ref":None,"x_mm":10,"y_mm":10,"z_mm":10}]
        r["instances"]=[{"id":name,"definition_id":"block","placement":{"x":x,"y":0,"z":0,"rx":0,"ry":0,"rz":0}} for name,x in (("moving",0),("overlap",5),("stop",30))]
        r["clearances"]=[{"id":"gap","first_id":"moving","second_id":"stop","min_mm":25}]
        r["motions"]=[{"id":"open","moving_ids":["moving"],"obstacle_ids":["stop"],"delta":{"x":40,"y":0,"z":0}}]
        with tempfile.TemporaryDirectory() as tmp:
            checks=render_assembly(r,tmp)["checks"]
        self.assertEqual(checks["collisions"]["status"],"complete")
        self.assertAlmostEqual(checks["collisions"]["overlaps"][0]["volume_mm3"],500)
        self.assertEqual(checks["clearances"][0]["distance_mm"],20)
        self.assertEqual(checks["clearances"][0]["status"],"insufficient")
        self.assertEqual(checks["motions"][0]["status"],"potential_obstruction")
        with patch('bob_cad.worker.COLLISION_PAIR_LIMIT',0),tempfile.TemporaryDirectory() as tmp:
            checks=render_assembly(r,tmp)["checks"]
        self.assertEqual(checks["collisions"]["status"],"partial")
        self.assertEqual(checks["collisions"]["skipped_pairs"],1)

    def test_nested_cuts_and_self_motion_fail_contract(self):
        r=fixture();r["definitions"][0]["cuts"]=[{"primitive":"box","x_mm":1,"y_mm":1,"z_mm":1,"cuts":[],"placement":r["instances"][0]["placement"]}]
        with self.assertRaises(CadContractError): validate_request(r)
        r=fixture();r["motions"]=[{"id":"motion","moving_ids":["post.left"],"obstacle_ids":["post.left"],"delta":{"x":10,"y":0,"z":0}}]
        with self.assertRaises(CadContractError): validate_request(r)

    def test_real_engine_generates_step_svg_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            result=render_assembly(fixture(),tmp)
            self.assertEqual(result["engine"],{"name":"build123d","version":"0.13.0","units":"mm"})
            self.assertEqual(len(result["instances"]),4)
            for view in fixture()["views"]:
                png=Path(tmp,view+".png").read_bytes()
                self.assertEqual(png[:8],b"\x89PNG\r\n\x1a\n")
                width,height=struct.unpack(">II",png[16:24])
                self.assertTrue(1<=width<=1024 and 1<=height<=1024)
                self.assertEqual(hashlib.sha256(png).hexdigest(),result["previews"][view]["sha256"])
                self.assertEqual(result["previews"][view]["source_sha256"],result["exports"][view]["sha256"])
            for name in ("assembly.step","front.svg","right.svg","top.svg","isometric.svg","manifest.json"):
                path=Path(tmp,name); self.assertTrue(path.exists()); self.assertGreater(path.stat().st_size,20)
            self.assertIn("ISO-10303-21",Path(tmp,"assembly.step").read_text(encoding="utf-8",errors="ignore"))
            self.assertIn("<svg",Path(tmp,"front.svg").read_text(encoding="utf-8").lower())

    def test_supplied_fastener_schedule_is_drawn_on_every_view_and_echoed_as_annotations_v2(self):
        import xml.etree.ElementTree as ET, json
        from test_annotations import schedule
        source={'artifact_id':'11111111-1111-4111-8111-111111111111','revision':3}
        fasteners=json.loads(json.dumps(schedule()))
        with tempfile.TemporaryDirectory() as plain_dir,tempfile.TemporaryDirectory() as tmp:
            plain=render_assembly(fixture(),plain_dir,source)
            self.assertEqual(plain['annotations']['version'],1)
            self.assertNotIn('fasteners',plain['annotations'])
            result=render_assembly(fixture(),tmp,source,fasteners)
            self.assertEqual(result['annotations']['version'],2)
            self.assertEqual(result['annotations']['fasteners'],fasteners,'the schedule is echoed exactly as sent')
            self.assertEqual(result['annotations']['views'],plain['annotations']['views'],'per-view notes are unchanged')
            for view in fixture()['views']:
                svg=Path(tmp,view+'.svg')
                texts=[e.text for e in ET.parse(svg).getroot().iter() if e.tag.endswith('}text')]
                self.assertIn('Fasteners - proposal from rules of thumb, no strength calculation',texts,view)
                self.assertIn('2.8 x 50',texts);self.assertIn('Glue: 1 package for 1 glued joint.',texts)
                self.assertEqual(hashlib.sha256(svg.read_bytes()).hexdigest(),result['previews'][view]['source_sha256'])
                with Image.open(Path(tmp,view+'.png')) as image:
                    self.assertEqual(max(image.size),1024)
        for bad in [dict(fasteners,extra=1),dict(fasteners,glue_packages=2),dict(fasteners,totals=[dict(fasteners['totals'][0],joint_ids=['invented'])]),
                    dict(fasteners,joints=[dict(fasteners['joints'][0],count=2.5)])]:
            with self.subTest(bad=bad),tempfile.TemporaryDirectory() as tmp,self.assertRaisesRegex(CadContractError,'fastener'):
                render_assembly(fixture(),tmp,source,bad)
        with tempfile.TemporaryDirectory() as tmp,self.assertRaisesRegex(CadContractError,'fasteners'):
            render_assembly(fixture(),tmp,None,fasteners)

    def test_definition_can_have_multiple_instances(self):
        parsed=validate_request(fixture())
        self.assertEqual(sum(i["definition_id"]=="post" for i in parsed["instances"]),2)

    def test_arbitrary_code_field_fails(self):
        bad=fixture(); bad["python"]="anything"
        with self.assertRaisesRegex(CadContractError,"request_shape"): validate_request(bad)

    def test_invalid_tube_fails(self):
        bad=fixture(); bad["definitions"][2]["wall_thickness_mm"]=16
        with self.assertRaisesRegex(CadContractError,"tube_wall_invalid"): validate_request(bad)

    def test_missing_definition_fails(self):
        bad=fixture(); bad["instances"][0]["definition_id"]="missing"
        with self.assertRaisesRegex(CadContractError,"instance"): validate_request(bad)

class CadTransportTest(unittest.TestCase):
    def test_authenticated_transport_returns_actual_matching_files(self):
        import base64, hashlib, json, os, threading, urllib.request, urllib.error
        from http.server import HTTPServer
        from unittest.mock import patch
        from bob_cad.server import Handler
        with patch.dict(os.environ, {"BOB_CAD_TOKEN": "fixture-token-" + "x" * 32}):
            server = HTTPServer(("127.0.0.1", 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            endpoint = f"http://127.0.0.1:{server.server_port}/render"
            try:
                bad = urllib.request.Request(endpoint, data=b'{}', method="POST")
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(bad, timeout=5)
                self.assertEqual(error.exception.code, 401)
                request = urllib.request.Request(endpoint, data=json.dumps(fixture()).encode(), method="POST", headers={"Authorization": "Bearer " + os.environ["BOB_CAD_TOKEN"], "Content-Type": "application/json"})
                with urllib.request.urlopen(request, timeout=45) as response:
                    packet = json.load(response)
                self.assertEqual(set(packet["files"]), {"step", "front", "right", "top", "isometric"})
                for key, encoded in packet["files"].items():
                    self.assertEqual(hashlib.sha256(base64.b64decode(encoded)).hexdigest(), packet["manifest"]["exports"][key]["sha256"])
                # Old two-key and new three-key construction envelopes are both served.
                from test_annotations import schedule
                source = {"artifact_id": "11111111-1111-4111-8111-111111111111", "revision": 3}
                small = {**fixture(), "views": ["front"]}
                for body, version in (({"recipe": small, "drawing_source": source}, 1), ({"recipe": small, "drawing_source": source, "fasteners": schedule()}, 2)):
                    request = urllib.request.Request(endpoint, data=json.dumps(body).encode(), method="POST", headers={"Authorization": "Bearer " + os.environ["BOB_CAD_TOKEN"], "Content-Type": "application/json"})
                    with urllib.request.urlopen(request, timeout=45) as response:
                        manifest = json.load(response)["manifest"]
                    self.assertEqual((manifest["annotations"]["version"], manifest["drawing_source"]), (version, source))
                    self.assertEqual(manifest["annotations"].get("fasteners"), body.get("fasteners"))
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

if __name__=="__main__": unittest.main()
