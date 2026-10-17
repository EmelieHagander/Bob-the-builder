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

if __name__=='__main__': unittest.main()
