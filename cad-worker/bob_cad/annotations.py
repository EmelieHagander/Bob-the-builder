"""Presentation of the kernel's exact exported view; no new construction."""
import itertools, math, xml.etree.ElementTree as ET

NS = 'http://www.w3.org/2000/svg'
def _v(a, b): return [a[k]-b[k] for k in range(3)]
def _dot(a,b): return sum(x*y for x,y in zip(a,b))
def _cross(a,b): return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
def _unit(a): return [x/math.sqrt(_dot(a,a)) for x in a]
def _number(n): return f'{n:.6f}'.rstrip('0').rstrip('.')

def annotate(path, req, rows, bounds, view, camera, up, center, source=None):
    tree=ET.parse(path); root=tree.getroot()
    left,top,width,height=map(float,root.attrib['viewBox'].split())
    scale=min(610/width,550/height)
    dx=75+(610-width*scale)/2-left*scale
    dy=85+(550-height*scale)/2-top*scale
    geometry=ET.Element(f'{{{NS}}}g',{'id':'Geometry','data-model-scale':str(scale),'transform':f'translate({dx},{dy}) scale({scale})'})
    for child in list(root): root.remove(child);geometry.append(child)
    root.append(geometry)
    page_height=max(750,170+min(len(rows),24)*32)
    root.attrib.update(width='1000px',height=f'{page_height}px',viewBox=f'0 0 1000 {page_height}')
    layer=ET.SubElement(root,f'{{{NS}}}g',{'id':'Annotations','font-family':'sans-serif','font-size':'15','fill':'#111'})
    def text(x,y,value,size=15,anchor='start'):
        el=ET.SubElement(layer,f'{{{NS}}}text',{'x':str(x),'y':str(y),'font-size':str(size),'text-anchor':anchor})
        el.text=value
    def line(a,b,dash=False):
        ET.SubElement(layer,f'{{{NS}}}line',{'x1':str(a[0]),'y1':str(a[1]),'x2':str(b[0]),'y2':str(b[1]),'stroke':'#555','stroke-width':'1',**({'stroke-dasharray':'4 3'} if dash else {})})
    zaxis=_unit(_v(camera,center));xaxis=_unit(_cross(up,zaxis));yaxis=_cross(zaxis,xaxis)
    def point(p):
        delta=_v(p,camera)
        return [dx+_dot(delta,xaxis)*scale,dy-_dot(delta,yaxis)*scale]
    corners=[point(c) for c in itertools.product(*zip(bounds['min'],bounds['max']))]
    x0,x1=min(p[0] for p in corners),max(p[0] for p in corners)
    y0,y1=min(p[1] for p in corners),max(p[1] for p in corners)
    # An immutable identity may contain obsolete dimensions after a revision;
    # it is not a presentation title. Keep it in the manifest, not the heading.
    text(30,32,f'Assembly / {view}',20)
    text(30,56,'Concept | Dimensions in mm | Not to scale | Product, fixing and strength checks remain open',13)
    view_axes={'front':(0,2),'right':(1,2),'top':(0,1)}
    dimensions=[]
    if view in view_axes:
        horizontal,vertical=view_axes[view]
        y=y1+28;line([x0,y1],[x0,y+7]);line([x1,y1],[x1,y+7]);line([x0,y],[x1,y])
        for x in [x0,x1]: line([x-4,y-4],[x+4,y+4])
        text((x0+x1)/2,y+20,f'{"XYZ"[horizontal]} {_number(bounds["size"][horizontal])}',16,'middle')
        x=x0-28;line([x0,y0],[x-7,y0]);line([x0,y1],[x-7,y1]);line([x,y0],[x,y1])
        for y in [y0,y1]: line([x-4,y-4],[x+4,y+4])
        text(x-7,(y0+y1)/2,f'{"XYZ"[vertical]} {_number(bounds["size"][vertical])}',16,'end')
        dimensions=[{'axis':'xyz'[axis],'mm':bounds['size'][axis]} for axis in [horizontal,vertical]]
    else:
        text(75,685,'Overall XYZ: '+' x '.join(_number(n) for n in bounds['size'])+' mm')
    text(740,96,'Part / instance / local blank (mm)',14)
    definitions={d['id']:d for d in req['definitions']}
    parts=[];labels=[]
    for index,row in enumerate(sorted(rows,key=lambda r:r['id']),1):
        number=f'P{index}';definition=definitions[row['definition_id']]
        dims={k:definition[k] for k in ['x_mm','y_mm','z_mm','diameter_mm','outside_diameter_mm','wall_thickness_mm','length_mm'] if k in definition}
        parts.append({'number':number,'instance_id':row['id'],'definition_id':row['definition_id'],'blank_mm':dims})
        if index>24: continue
        y=120+(index-1)*32
        label=number+' '+(row['id'] if len(row['id'])<=28 else row['id'][:25]+'...')
        text(740,y,label,13)
        axes={'box':'XYZ','cylinder':'D/L','tube':'OD/W/L'}[definition['primitive']]
        text(740,y+12,axes+' '+ ' / '.join(_number(v) for v in dims.values()),11)
        target=point([(row['bounding_box_mm']['min'][k]+row['bounding_box_mm']['max'][k])/2 for k in range(3)])
        anchor=[target[0],target[1]-5]
        for offset in range(24):
            anchor=[target[0]+(25 if offset%2 else -25) if offset else target[0],target[1]-5-(offset//2)*20]
            if all(math.dist(anchor,previous)>20 for previous in labels): break
        labels.append(anchor)
        if math.dist(anchor,target)>10: line(target,anchor)
        ET.SubElement(layer,f'{{{NS}}}rect',{'x':str(anchor[0]-12),'y':str(anchor[1]-12),'width':'24','height':'16','fill':'white'})
        text(*anchor,number,14,'middle')
    if source: text(30,page_height-48,f'Construction {source["artifact_id"]} / revision {source["revision"]}',13)
    text(30,page_height-25,'Blank dimensions exclude machining allowances. Labels identify saved instances; no fabrication approval.',13)
    ET.register_namespace('',NS);tree.write(path,encoding='utf-8',xml_declaration=True)
    return {'dimensions':dimensions,'parts':parts,'coverage':'complete' if len(rows)<=24 else 'partial'}
