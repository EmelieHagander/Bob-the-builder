"""Pagination uses only saved geometry and is testable without the CAD kernel."""
import tempfile, unittest, xml.etree.ElementTree as ET
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('cad_annotations',Path(__file__).parent/'bob_cad/annotations.py')
annotations=importlib.util.module_from_spec(spec);spec.loader.exec_module(annotations)
annotate,PARTS_PER_PAGE=annotations.annotate,annotations.PARTS_PER_PAGE

NS='{http://www.w3.org/2000/svg}'

class AnnotationPagesTest(unittest.TestCase):
    def test_every_instance_has_one_readable_sheet_and_stable_number(self):
        for count in (24,25,32,33,128,512):
            with self.subTest(count=count), tempfile.TemporaryDirectory() as tmp:
                path=Path(tmp,'front.svg')
                path.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g id="Visible"><path d="M0 0 L100 100"/></g></svg>')
                req={'definitions':[{'id':'part','primitive':'box','x_mm':10,'y_mm':20,'z_mm':30}]}
                # Coincident projected centers exercise label separation too.
                box={'min':[0,0,0],'max':[10,20,30],'size':[10,20,30]}
                rows=[{'id':f'part{i:03}','definition_id':'part','bounding_box_mm':box} for i in reversed(range(count))]
                notes=annotate(path,req,rows,box,'front',[5,-100,15],[0,0,1],[5,10,15],{'artifact_id':'source','revision':7})
                self.assertEqual(notes['coverage'],'complete')
                self.assertEqual([p['instance_id'] for p in notes['parts']],sorted(r['id'] for r in rows))
                root=ET.parse(path).getroot()
                pages=[g for g in root if g.get('id','').startswith('DrawingPage')]
                self.assertEqual(len(pages),(count+PARTS_PER_PAGE-1)//PARTS_PER_PAGE)
                seen=[]
                for page in pages:
                    texts=[el.text for el in page.iter(NS+'text')]
                    numbers=[el for el in page.iter(NS+'text') if el.get('text-anchor')=='middle' and (el.text or '').startswith('P')]
                    self.assertLessEqual(len(numbers),PARTS_PER_PAGE)
                    seen.extend(el.text for el in numbers)
                    self.assertIn('Construction source / revision 7',texts)
                    for i,a in enumerate(numbers):
                        x,y=float(a.get('x')),float(a.get('y'))
                        self.assertTrue(100<=x<=660 and 110<=y<=610)
                        for b in numbers[:i]:
                            self.assertTrue(abs(x-float(b.get('x')))>=48 or abs(y-float(b.get('y')))>=22)
                self.assertEqual(seen,[f'P{i}' for i in range(1,count+1)])
                self.assertEqual(len(list(root.iter(NS+'path'))),1,'Geometry paths are shared, never copied per sheet')

def schedule(joints=None,totals=None):
    """A fastener-rules-v1 schedule as the server returns it (owner decisions 2026-10-26)."""
    def joint(jid,kind,d,length,n,source='rule',gaps=(),method='screwed_butt'):
        return {'joint_id':jid,'method':method,'source':source,'kind':kind,'diameter_mm':d,'length_mm':length,'count':n,'spacing_mm':None,
                'through_instance_id':'part000','through_mm':45,'embed_mm':900,'contact_length_mm':70,'contact_width_mm':45,'proposal':None,'gaps':list(gaps)}
    return {'rule_version':'fastener-rules-v1','complete':False,'glue_packages':1,
            'joints':joints if joints is not None else [joint('left_rail','screw',5.0,120,2),joint('right_rail','screw',5.0,120,2),
                     joint('glued','glue',None,None,None,method='glued_butt'),joint('dowel',None,None,None,None,'no_rule',['no_rule_for_method'],'dowel'),
                     joint('nailed','nail',2.8,50,3,'override',['narrow_contact'])],
            'totals':totals if totals is not None else [{'kind':'nail','diameter_mm':2.8,'length_mm':50,'count':3,'joint_ids':['nailed']},
                     {'kind':'screw','diameter_mm':5.0,'length_mm':120,'count':4,'joint_ids':['left_rail','right_rail']}]}

class FastenerBandTest(unittest.TestCase):
    def test_grouped_rows_glue_and_unsized_joints_are_stated_as_a_proposal(self):
        lines=annotations.fastener_lines(schedule())
        self.assertEqual(lines,[('title','Fasteners - proposal from rules of thumb, no strength calculation'),
            ('header',('No.','Fastener','d x L (mm)','Qty','Basis')),
            ('row',('F1','Nail','2.8 x 50','3','override')),('row',('F2','Screw','5.0 x 120','4','rule')),
            ('note','Glue: 1 package for 1 glued joint.'),('note','No fastener rule or size yet for 1 joint.'),
            ('note','Rule warnings (short or narrow contact, short screw) on 1 joint - check before building.')])
        mixed=schedule(totals=[{'kind':'screw','diameter_mm':4.5,'length_mm':70,'count':5,'joint_ids':['left_rail','nailed']}])
        self.assertEqual(annotations.fastener_lines(mixed)[2],('row',('F1','Screw','4.5 x 70','5','rule and override')))
        empty=annotations.fastener_lines({**schedule(joints=[],totals=[]),'glue_packages':0,'complete':True})
        self.assertEqual(empty[2:],[('note','No screws, nails or bolts in the saved joints.')])

    def test_band_is_on_sheet_one_only_inside_its_page_and_clear_of_geometry_and_footer(self):
        for count in (1,32,33):
            with self.subTest(count=count), tempfile.TemporaryDirectory() as tmp:
                path=Path(tmp,'front.svg')
                path.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g id="Visible"><path d="M0 0 L100 100"/></g></svg>')
                req={'definitions':[{'id':'part','primitive':'box','x_mm':10,'y_mm':20,'z_mm':30}]}
                box={'min':[0,0,0],'max':[10,20,30],'size':[10,20,30]}
                rows=[{'id':f'part{i:03}','definition_id':'part','bounding_box_mm':box} for i in range(count)]
                source={'artifact_id':'source','revision':7}
                plain=Path(tmp,'plain.svg');plain.write_text(path.read_text())
                annotate(plain,req,rows,box,'front',[5,-100,15],[0,0,1],[5,10,15],source)
                plain_root=ET.parse(plain).getroot()
                self.assertEqual(plain_root.get('data-page-height'),str(max(750,170+min(count,PARTS_PER_PAGE)*32)),'no schedule: sheets unchanged')
                self.assertFalse(any((el.text or '').startswith('Fasteners') for el in plain_root.iter(NS+'text')))
                notes=annotate(path,req,rows,box,'front',[5,-100,15],[0,0,1],[5,10,15],source,schedule())
                self.assertEqual(set(notes),{'dimensions','parts','coverage'},'per-view notes keep their exact shape')
                root=ET.parse(path).getroot();height=float(root.get('data-page-height'))
                pages=[g for g in root if g.get('id','').startswith('DrawingPage')]
                texts=[[el for el in page.iter(NS+'text')] for page in pages]
                title=[el for el in texts[0] if (el.text or '').startswith('Fasteners - proposal')]
                self.assertEqual(len(title),1)
                self.assertFalse(any((el.text or '').startswith('Fasteners') for page in texts[1:] for el in page),'band only on sheet 1')
                footer=[el for el in texts[0] if (el.text or '').startswith(('Construction source','Blank dimensions'))]
                band=[el for el in texts[0] if float(el.get('y'))>=annotations.FASTENER_TOP and float(el.get('x'))<740 and el not in footer]
                self.assertEqual(len(band),1+5+2*5+3,'title, five header cells, two rows of five cells, three notes')
                self.assertEqual(min(float(el.get('y')) for el in footer),height-48)
                self.assertLessEqual(max(float(el.get('y')) for el in band),height-66)
                self.assertTrue(all(float(el.get('x'))<740 for el in band),'band stays left of the part table')
                self.assertIn('F2',[el.text for el in band])
                self.assertGreaterEqual(height,750)

if __name__=='__main__': unittest.main()
