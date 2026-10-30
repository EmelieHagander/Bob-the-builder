"""Pagination uses only saved geometry and is testable without the CAD kernel."""
import tempfile, unittest, xml.etree.ElementTree as ET
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('cad_annotations',Path(__file__).parent/'bob_cad/annotations.py')
annotations=importlib.util.module_from_spec(spec);spec.loader.exec_module(annotations)
annotate,PARTS_PER_PAGE=annotations.annotate,annotations.PARTS_PER_PAGE

NS='{http://www.w3.org/2000/svg}'

def callout_numbers(value):
    numbers=[]
    for mark in value.replace(',',' ').split():
        first,_,last=mark.partition('-')
        numbers+=range(int(first[1:]),int((last or first)[1:])+1)
    return numbers

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
                    callouts=[el for el in page.iter(NS+'text') if el.get('text-anchor')=='middle' and (el.text or '').startswith('P')]
                    self.assertLessEqual(len(callouts),PARTS_PER_PAGE)
                    seen.extend(n for el in callouts for n in callout_numbers(el.text))
                    self.assertIn('Construction version 7 - ID source',texts)
                    for el in callouts:
                        x,y=float(el.get('x')),float(el.get('y'))
                        self.assertTrue(100<=x<=660 and 110<=y<=610+18*PARTS_PER_PAGE)
                    # Identical boxes project onto one spot: one shared callout per sheet.
                    self.assertEqual(len({(el.get('x'),) for el in callouts}),1)
                self.assertEqual(seen,list(range(1,count+1)))
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
                self.assertEqual(plain_root.get('data-page-height'),'750','no schedule: one kind of part fits the standard sheet')
                self.assertFalse(any((el.text or '').startswith('Fasteners') for el in plain_root.iter(NS+'text')))
                notes=annotate(path,req,rows,box,'front',[5,-100,15],[0,0,1],[5,10,15],source,schedule())
                self.assertEqual(set(notes),{'dimensions','parts','coverage'},'per-view notes keep their exact shape')
                root=ET.parse(path).getroot();height=float(root.get('data-page-height'))
                pages=[g for g in root if g.get('id','').startswith('DrawingPage')]
                texts=[[el for el in page.iter(NS+'text')] for page in pages]
                title=[el for el in texts[0] if (el.text or '').startswith('Fasteners - proposal')]
                self.assertEqual(len(title),1)
                self.assertFalse(any((el.text or '').startswith('Fasteners') for page in texts[1:] for el in page),'band only on sheet 1')
                footer=[el for el in texts[0] if (el.text or '').startswith(('Construction version','Part sizes'))]
                band=[el for el in texts[0] if float(el.get('y'))>=annotations.FASTENER_TOP and float(el.get('x'))<740 and el not in footer]
                self.assertEqual(len(band),1+5+2*5+3,'title, five header cells, two rows of five cells, three notes')
                self.assertEqual(min(float(el.get('y')) for el in footer),height-48)
                self.assertLessEqual(max(float(el.get('y')) for el in band),height-66)
                self.assertTrue(all(float(el.get('x'))<740 for el in band),'band stays left of the part table')
                self.assertIn('F2',[el.text for el in band])
                self.assertGreaterEqual(height,750)

def blank_svg(tmp):
    path=Path(tmp,'view.svg')
    path.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g id="Visible"><path d="M0 0 L100 100"/></g></svg>')
    return path

def texts_of(path):
    return [el.text for el in ET.parse(path).getroot().iter(NS+'text')]

class PlainLanguageTest(unittest.TestCase):
    """Sheets read for people without drawing experience; exact notes stay unchanged."""
    def test_part_names_drop_ids_sizes_and_never_claim_a_size(self):
        self.assertEqual(annotations.part_name('leg_45x45x430'),'Leg')
        self.assertEqual(annotations.part_name('sidePanel.left'),'Side panel left')
        self.assertEqual(annotations.part_name('retained_assembly_600_800_300'),'Retained assembly')
        self.assertEqual(annotations.part_name('P1'),'Part')
        self.assertEqual(annotations.part_name('a_very_long_descriptive_cabinet_part'),'A very long descript...')

    def test_blank_sizes_name_the_length(self):
        self.assertEqual(annotations.blank_text({'primitive':'box','x_mm':1110,'y_mm':45,'z_mm':45}),'45 x 45 mm, length 1110 mm')
        self.assertEqual(annotations.blank_text({'primitive':'box','x_mm':600,'y_mm':18,'z_mm':400}),'18 x 400 mm, length 600 mm')
        self.assertEqual(annotations.blank_text({'primitive':'tube','outside_diameter_mm':42.4,'wall_thickness_mm':2.6,'length_mm':900}),'Tube, dia. 42.4, wall 2.6, length 900 mm')
        self.assertEqual(annotations.blank_text({'primitive':'cylinder','diameter_mm':8,'length_mm':40}),'Round, diameter 8, length 40 mm')

    def test_parts_are_grouped_by_kind_and_every_number_is_listed_once(self):
        definitions={'leg':{'primitive':'box','x_mm':45,'y_mm':45,'z_mm':430},'rail':{'primitive':'box','x_mm':1110,'y_mm':45,'z_mm':45}}
        rows=[{'definition_id':d} for d in ('leg','leg','rail','leg','rail')]
        lines=annotations.part_lines(list(enumerate(rows,1)),definitions)
        self.assertEqual(lines,[(13,'P1-P2, P4: 3 x Leg'),(11,'45 x 45 mm, length 430 mm'),(0,''),(13,'P3, P5: 2 x Rail'),(11,'45 x 45 mm, length 1110 mm')])
        many=annotations.part_lines([(n,{'definition_id':'leg' if n%2 else 'rail'}) for n in range(1,33)],definitions)
        listed=' '.join(t for size,t in many if size==13)
        self.assertEqual(sorted(int(n) for n in __import__('re').findall(r'P(\d+)',listed)),list(range(1,33)))
        self.assertTrue(all(len(t)<=annotations.COLUMN_CHARS+1 for size,t in many if size==13),'marker lines wrap inside the column')

    def test_dimensions_use_words_with_the_axis_letter_and_every_view_explains_directions(self):
        req={'definitions':[{'id':'post','primitive':'box','x_mm':45,'y_mm':70,'z_mm':900}]}
        box={'min':[0,0,0],'max':[45,70,900],'size':[45,70,900]}
        rows=[{'id':'post','definition_id':'post','bounding_box_mm':box}]
        center=[22.5,35,450]
        cases={'front':([22.5,-5000,450],[0,0,1],['Width 45 mm (X)','Height 900 mm (Z)','Y depth: away from you']),
               'back':([22.5,5000,450],[0,0,1],['Width 45 mm (X)','Height 900 mm (Z)','Y depth: towards you']),
               'top':([22.5,35,5000],[0,1,0],['Width 45 mm (X)','Depth 70 mm (Y)','Z height: towards you']),
               'isometric':([5000,-5000,5000],[0,0,1],['Total size: width 45 x depth 70 x height 900 mm (X x Y x Z)','X width','Y depth','Z height'])}
        for view,(camera,up,expected) in cases.items():
            with self.subTest(view=view), tempfile.TemporaryDirectory() as tmp:
                path=blank_svg(tmp)
                notes=annotate(path,req,rows,box,view,camera,up,center,{'artifact_id':'source','revision':2})
                texts=texts_of(path)
                self.assertIn(annotations.VIEW_TITLES[view],texts)
                self.assertIn('Directions in this view',texts)
                for value in expected: self.assertIn(value,texts)
                self.assertFalse(any(t.startswith(('XYZ','Overall XYZ','Assembly /')) for t in texts),'no bare axis codes')
                self.assertEqual(notes['parts'],[{'number':'P1','instance_id':'post','definition_id':'post','blank_mm':{'x_mm':45,'y_mm':70,'z_mm':900}}],'exact notes unchanged')

    def test_many_kinds_of_part_grow_the_sheet_and_stay_above_the_footer(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=blank_svg(tmp)
            req={'definitions':[{'id':f'kind_{chr(97+i)}{chr(97+i)}','primitive':'box','x_mm':10+i,'y_mm':20,'z_mm':30} for i in range(26)]}
            box={'min':[0,0,0],'max':[40,20,30],'size':[40,20,30]}
            rows=[{'id':f'part{i:03}','definition_id':req['definitions'][i%26]['id'],'bounding_box_mm':box} for i in range(40)]
            annotate(path,req,rows,box,'front',[20,-100,15],[0,0,1],[20,10,15],{'artifact_id':'source','revision':1})
            root=ET.parse(path).getroot();height=float(root.get('data-page-height'))
            self.assertGreater(height,750)
            for page in [g for g in root if g.get('id','').startswith('DrawingPage')]:
                column=[float(el.get('y')) for el in page.iter(NS+'text') if float(el.get('x'))==annotations.COLUMN_X]
                self.assertLessEqual(max(column),height-75)

class CalloutTest(unittest.TestCase):
    def test_parts_behind_each_other_share_one_callout_and_separate_parts_keep_their_own(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=blank_svg(tmp)
            req={'definitions':[{'id':'leg','primitive':'box','x_mm':45,'y_mm':45,'z_mm':430}]}
            box=lambda x,y:{'min':[x,y,0],'max':[x+45,y+45,430],'size':[45,45,430]}
            rows=[{'id':'a_front_left','definition_id':'leg','bounding_box_mm':box(0,0)},{'id':'b_front_right','definition_id':'leg','bounding_box_mm':box(1155,0)},
                  {'id':'c_back_left','definition_id':'leg','bounding_box_mm':box(0,315)},{'id':'d_back_right','definition_id':'leg','bounding_box_mm':box(1155,315)}]
            bounds={'min':[0,0,0],'max':[1200,360,430],'size':[1200,360,430]}
            annotate(path,req,rows,bounds,'front',[600,-5000,215],[0,0,1],[600,180,215])
            callouts=sorted(el.text for el in ET.parse(path).getroot().iter(NS+'text') if el.get('text-anchor')=='middle' and (el.text or '').startswith('P'))
            self.assertEqual(callouts,['P1, P3','P2, P4'])
            path=blank_svg(tmp)
            annotate(path,req,rows,bounds,'top',[600,180,5000],[0,1,0],[600,180,215])
            callouts=sorted(el.text for el in ET.parse(path).getroot().iter(NS+'text') if el.get('text-anchor')=='middle' and (el.text or '').startswith('P'))
            self.assertEqual(callouts,['P1','P2','P3','P4'])

    def test_long_shared_callouts_wrap_and_list_every_number(self):
        lines=annotations.wrap_marks(annotations.marker_ranges(list(range(1,32,2))),annotations.LABEL_CHARS)
        self.assertTrue(all(len(line)<=annotations.LABEL_CHARS+1 for line in lines))
        self.assertEqual([n for line in lines for n in callout_numbers(line)],list(range(1,32,2)))

    def test_every_sheet_explains_solid_and_dashed_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=blank_svg(tmp)
            box={'min':[0,0,0],'max':[10,20,30],'size':[10,20,30]}
            rows=[{'id':f'part{i:03}','definition_id':'part','bounding_box_mm':box} for i in range(40)]
            annotate(path,{'definitions':[{'id':'part','primitive':'box','x_mm':10,'y_mm':20,'z_mm':30}]},rows,box,'isometric',[100,-100,100],[0,0,1],[5,10,15])
            for page in [g for g in ET.parse(path).getroot() if g.get('id','').startswith('DrawingPage')]:
                texts=[el.text for el in page.iter(NS+'text')]
                self.assertIn('Solid line: edge you can see',texts)
                self.assertIn('Dashed line: edge hidden behind',texts)

if __name__=='__main__': unittest.main()
