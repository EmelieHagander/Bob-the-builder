"""Presentation of the kernel's exact exported view; no new construction.

Sheets are written for people who have never read a technical drawing: every
axis letter comes with a word and a direction arrow, and parts are grouped by
kind. The exact per-instance numbers stay in the returned notes (manifest)."""
import itertools, math, re, xml.etree.ElementTree as ET

NS = 'http://www.w3.org/2000/svg'
PARTS_PER_PAGE = 32
def _v(a, b): return [a[k]-b[k] for k in range(3)]
def _dot(a,b): return sum(x*y for x,y in zip(a,b))
def _cross(a,b): return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
def _unit(a): return [x/math.sqrt(_dot(a,a)) for x in a]
def _number(n): return f'{n:.6f}'.rstrip('0').rstrip('.')
# Diameters read like the rule table (3.5, 4.0 ... 6.0); other values stay exact.
def _diameter(d): return f'{d:.1f}' if abs(d*10-round(d*10))<1e-9 else _number(d)
def _plural(n,one,many): return f'{n} {one if n==1 else many}'

FASTENER_TOP = 715
FASTENER_LINE = 18
FASTENER_KINDS = {'screw':'Screw','nail':'Nail','bolt':'Bolt'}
MECHANICAL = ('screw','nail','bolt')

VIEW_TITLES = {'front':'Front view - seen from the front','back':'Back view - seen from behind',
               'left':'Left side view - seen from the left','right':'Right side view - seen from the right',
               'top':'Top view - seen from above','bottom':'Bottom view - seen from below',
               'isometric':'Overview - from the front right, above','isometric_front_left':'Overview - from the front left, above',
               'isometric_back_left':'Overview - from the back left, above','isometric_back_right':'Overview - from the back right, above'}
# Assembly X, Y, Z in the same words as the app (src/lib/labels.ts).
AXIS_WORDS = ('Width','Depth','Height')
COLUMN_X = 740
PARTS_TOP = 296
# Orthographic views share the sheet with position scales below and right of the geometry.
VIEW_AXES = {'front':(0,2),'back':(0,2),'left':(1,2),'right':(1,2),'top':(0,1),'bottom':(0,1)}
COLUMN_CHARS = 32
# Parts whose centres project within this distance (one behind the other) share one callout.
COINCIDENT_PX = 3
LABEL_CHARS = 14

def part_name(identifier):
    """A Bob-authored id as plain words. Tokens with digits are dropped: stable
    ids can keep sizes from an earlier revision and must not claim a size."""
    words=re.sub(r'([a-z])([A-Z])',r'\1 \2',identifier)
    tokens=[t for t in re.split(r'[_.:\-\s]+',words) if t and not re.search(r'\d',t) and t.lower()!='mm']
    name=' '.join(tokens).lower()
    if not name: return 'Part'
    name=name[0].upper()+name[1:]
    return name if len(name)<=22 else name[:20].rstrip()+'...'

def blank_text(d):
    """Blank size in plain words; for a box the longest side is the length."""
    if d['primitive']=='box':
        a,b,c=sorted((d['x_mm'],d['y_mm'],d['z_mm']))
        return f'{_number(a)} x {_number(b)} mm, length {_number(c)} mm'
    if d['primitive']=='tube':
        return f"Tube, dia. {_number(d['outside_diameter_mm'])}, wall {_number(d['wall_thickness_mm'])}, length {_number(d['length_mm'])} mm"
    return f"Round, diameter {_number(d['diameter_mm'])}, length {_number(d['length_mm'])} mm"

def marker_ranges(numbers):
    runs=[]
    for n in numbers:
        if runs and n==runs[-1][1]+1: runs[-1][1]=n
        else: runs.append([n,n])
    return [f'P{a}' if a==b else f'P{a}-P{b}' for a,b in runs]

def part_lines(numbered, definitions):
    """One sheet's part column as (font size, text) lines: one group per
    definition in P-number order, listing every P-number on the sheet once."""
    groups={}
    for number,row in numbered: groups.setdefault(row['definition_id'],[]).append(number)
    lines=[]
    for definition_id,numbers in groups.items():
        head=f'{len(numbers)} x {part_name(definition_id)}'
        marks=marker_ranges(numbers)
        if len(', '.join(marks))+2+len(head)<=COLUMN_CHARS: lines.append((13,', '.join(marks)+': '+head))
        else:
            current=''
            for mark in marks:
                if current and len(current)+2+len(mark)>COLUMN_CHARS: lines.append((13,current+',')); current=mark
                else: current=current+', '+mark if current else mark
            lines+= [(13,current),(13,head)]
        lines.append((11,blank_text(definitions[definition_id])))
        lines.append((0,''))
    return lines[:-1]

def wrap_marks(marks, limit):
    lines=[]
    for mark in marks:
        if lines and len(lines[-1])+2+len(mark)<=limit: lines[-1]+=', '+mark
        else:
            if lines: lines[-1]+=','
            lines.append(mark)
    return lines

def _column_bottom(lines):
    y=PARTS_TOP+22
    for size,_ in lines: y+={13:14,11:12,0:4}[size]
    return y

def fastener_lines(fasteners):
    """Sheet 1's compact band: grouped rows F1, F2... in the saved totals order,
    glue packages and what the rules could not size. The schedule is a
    rule-of-thumb proposal from the saved geometry, never a strength result."""
    basis={j['joint_id']:j['source'] for j in fasteners['joints']}
    lines=[('title','Fasteners - proposal from rules of thumb, no strength calculation'),
           ('header',('No.','Fastener','d x L (mm)','Qty','Basis'))]
    for index,total in enumerate(fasteners['totals'],1):
        sources={basis.get(i) for i in total['joint_ids']}
        lines.append(('row',(f'F{index}',FASTENER_KINDS[total['kind']],f"{_diameter(total['diameter_mm'])} x {_number(total['length_mm'])}",
                             str(total['count']),'rule' if sources=={'rule'} else 'override' if sources=={'override'} else 'rule and override')))
    if not fasteners['totals']: lines.append(('note','No screws, nails or bolts in the saved joints.'))
    glued=sum(j['kind']=='glue' for j in fasteners['joints'])
    if fasteners['glue_packages']: lines.append(('note',f"Glue: {_plural(fasteners['glue_packages'],'package','packages')} for {_plural(glued,'glued joint','glued joints')}."))
    unsized={j['joint_id'] for j in fasteners['joints'] if j['source']=='no_rule' or j['kind'] in MECHANICAL and None in (j['diameter_mm'],j['length_mm'],j['count'])}
    if unsized: lines.append(('note',f"No fastener rule or size yet for {_plural(len(unsized),'joint','joints')}."))
    flagged=sum(1 for j in fasteners['joints'] if j['gaps'] and j['joint_id'] not in unsized)
    if flagged: lines.append(('note',f"Rule warnings (short or narrow contact, short screw) on {_plural(flagged,'joint','joints')} - check before building."))
    return lines

def annotate(path, req, rows, bounds, view, camera, up, center, source=None, fasteners=None):
    tree=ET.parse(path); root=tree.getroot()
    left,top,width,height=map(float,root.attrib['viewBox'].split())
    fit_width,fit_height=(560,500) if view in VIEW_AXES else (610,550)
    scale=min(fit_width/width,fit_height/height)
    dx=75+(fit_width-width*scale)/2-left*scale
    dy=85+(fit_height-height*scale)/2-top*scale
    # Reuse the exact exported geometry on every sheet, without duplicating its
    # paths or splitting the source construction. Only the numbered subset varies.
    model=ET.Element(f'{{{NS}}}g',{'id':'ModelGeometry'})
    for child in list(root): root.remove(child);model.append(child)
    ET.SubElement(root,f'{{{NS}}}defs').append(model)
    page_count=math.ceil(len(rows)/PARTS_PER_PAGE)
    band=fastener_lines(fasteners) if fasteners is not None else []
    definitions={d['id']:d for d in req['definitions']}
    numbered=list(enumerate(sorted(rows,key=lambda r:r['id']),1))
    columns=[part_lines(numbered[i:i+PARTS_PER_PAGE],definitions) for i in range(0,len(numbered),PARTS_PER_PAGE)]
    # Every sheet keeps one height: the longest part column, or sheet 1's band, ends above the footer.
    page_height=max(750,max(_column_bottom(c) for c in columns)+75,FASTENER_TOP+len(band)*FASTENER_LINE+60 if band else 0)
    root.attrib.update(width='1000px',height=f'{page_count*page_height}px',viewBox=f'0 0 1000 {page_count*page_height}',
                       **{'data-page-height':str(page_height),'data-page-count':str(page_count)})
    layer=None
    def text(x,y,value,size=15,anchor='start'):
        el=ET.SubElement(layer,f'{{{NS}}}text',{'x':str(x),'y':str(y),'font-size':str(size),'text-anchor':anchor})
        el.text=value
        return el
    def line(a,b,dash=False,stroke='#555',width=1):
        ET.SubElement(layer,f'{{{NS}}}line',{'x1':str(a[0]),'y1':str(a[1]),'x2':str(b[0]),'y2':str(b[1]),'stroke':stroke,'stroke-width':str(width),**({'stroke-dasharray':'4 3'} if dash else {})})
    zaxis=_unit(_v(camera,center));xaxis=_unit(_cross(up,zaxis));yaxis=_cross(zaxis,xaxis)
    def point(p):
        delta=_v(p,camera)
        return [dx+_dot(delta,xaxis)*scale,dy-_dot(delta,yaxis)*scale]
    def directions():
        # Which way X, Y and Z point in this view; an axis along the line of sight is said in words.
        text(COLUMN_X,92,'Directions in this view',14)
        ox,oy=840,154
        for k,word in enumerate(AXIS_WORDS):
            unit=[float(k==i) for i in range(3)]
            sx,sy=_dot(unit,xaxis),-_dot(unit,yaxis);length=math.hypot(sx,sy)
            label=f'{"XYZ"[k]} {word.lower()}'
            if length<0.25:
                text(COLUMN_X,196,f'{label}: {"towards" if _dot(unit,zaxis)>0 else "away from"} you',12);continue
            ux,uy=sx/length,sy/length;tip=[ox+ux*30,oy+uy*30]
            line([ox,oy],tip,stroke='#111',width=1.5)
            for side in (1,-1): line(tip,[tip[0]-ux*7-side*uy*4,tip[1]-uy*7+side*ux*4],stroke='#111',width=1.5)
            text(tip[0]+ux*8,tip[1]+uy*14+5,label,13,'start' if ux>0.3 else 'end' if ux<-0.3 else 'middle')
        # Line key: the same solid and dashed strokes as the geometry layers.
        line([COLUMN_X,218],[COLUMN_X+28,218],stroke='#111',width=1.25);text(COLUMN_X+36,222,'Solid line: edge you can see',12)
        line([COLUMN_X,236],[COLUMN_X+28,236],dash=True,stroke='#111',width=0.8);text(COLUMN_X+36,240,'Dashed line: edge hidden behind',12)
        if marks:
            text(COLUMN_X,262,'Scales: mm measured from the 0 mark',12)
            if hidden: text(COLUMN_X,277,f'{_plural(hidden,"mark","marks")} too close together to number',12)
    def callouts(page_rows):
        # One callout per spot: parts whose centres project onto the same point share a label such as P7-P9.
        spots=[]
        for index,row in page_rows:
            target=point([(row['bounding_box_mm']['min'][k]+row['bounding_box_mm']['max'][k])/2 for k in range(3)])
            spot=next((s for s in spots if math.dist(s[0],target)<=COINCIDENT_PX),None)
            if spot: spot[1].append(index)
            else: spots.append((target,[index]))
        placed=[]
        for target,numbers in spots:
            rows_of_text=wrap_marks(marker_ranges(numbers),LABEL_CHARS)
            width=max(len(t) for t in rows_of_text)*9+8;height=20+18*(len(rows_of_text)-1)
            def free(a):
                return all(abs(a[0]-x)>=max(48,(width+w)/2+4) or (abs(a[1]-y)>=22 and (a[1]-14>=y-14+h+2 or y-14>=a[1]-14+height+2)) for x,y,w,h in placed)
            right,bottom=(620,570) if view in view_axes else (660,610)
            near=[min(right,max(100,target[0])),min(bottom,max(110,target[1]-5))]
            candidates=[near]+sorted(([100+x*40,110+y*24] for x in range(15) for y in range(21) if 100+x*40<=right and 110+y*24<=bottom),key=lambda a:math.dist(a,target))
            anchor=next((a for a in candidates if free(a)),near)
            placed.append((anchor[0],anchor[1],width,height))
            if math.dist(anchor,target)>10: line(target,anchor)
            ET.SubElement(layer,f'{{{NS}}}rect',{'x':str(anchor[0]-width/2),'y':str(anchor[1]-14),'width':str(width),'height':str(height),'fill':'white'})
            for i,value in enumerate(rows_of_text): text(anchor[0],anchor[1]+i*18,value,14,'middle')
    corners=[point(c) for c in itertools.product(*zip(bounds['min'],bounds['max']))]
    x0,x1=min(p[0] for p in corners),max(p[0] for p in corners)
    y0,y1=min(p[1] for p in corners),max(p[1] for p in corners)
    view_axes=VIEW_AXES
    # Position scales: where each part starts along the two axes in this view, in mm
    # from the assembly's near edge, from the same kernel bounds as the geometry.
    marks=[];hidden=0
    if view in view_axes:
        def at(axis,value):
            place=list(bounds['min']);place[axis]+=value
            return point(place)
        for kind,axis in zip('hv',view_axes[view]):
            values=sorted({round(r['bounding_box_mm']['min'][axis]-bounds['min'][axis],1) for r in rows}|{0.0})
            taken=[[],[]]
            for value in values:
                label=_number(value);spot=at(axis,value)[0 if kind=='h' else 1];half=len(label)*3.3+2
                slot=next((i for i in (0,1) if all(abs(spot-q)>=(half+w+4 if kind=='h' else 12) for q,w in taken[i])),None)
                if slot is None: hidden+=1
                else: taken[slot].append((spot,half))
                marks.append((kind,spot,slot,label))
    dimensions=[{'axis':'xyz'[axis],'mm':bounds['size'][axis]} for axis in view_axes.get(view,[])]
    def sized(axis): return f'{AXIS_WORDS[axis]} {_number(bounds["size"][axis])} mm ({"XYZ"[axis]})'
    parts=[]
    for index,row in numbered:
        slot=(index-1)%PARTS_PER_PAGE
        if slot==0:
            page=(index-1)//PARTS_PER_PAGE
            sheet=ET.SubElement(root,f'{{{NS}}}g',{'id':f'DrawingPage{page+1}','transform':f'translate(0,{page*page_height})'})
            geometry=ET.SubElement(sheet,f'{{{NS}}}g',{'id':'Geometry' if page==0 else f'Geometry{page+1}',
                'data-model-scale':str(scale),'transform':f'translate({dx},{dy}) scale({scale})'})
            ET.SubElement(geometry,f'{{{NS}}}use',{'href':'#ModelGeometry'})
            layer=ET.SubElement(sheet,f'{{{NS}}}g',{'id':f'Annotations{page+1}','font-family':'sans-serif','font-size':'15','fill':'#111'})
            # Stable identities can contain obsolete dimensions; keep them out
            # of the presentation title. Every sheet pins the same exact source.
            text(30,32,VIEW_TITLES[view],20)
            text(970,32,f'Sheet {page+1}/{page_count}',15,'end')
            text(30,56,'Concept drawing - measurements in mm - not to scale - products, fixings and strength not yet checked',13)
            if view in view_axes:
                horizontal,vertical=view_axes[view]
                ys,xs=y1+14,x1+16
                line([x0,ys],[x1,ys]);line([xs,y0],[xs,y1])
                for kind,spot,slot,label in marks:
                    if kind=='h':
                        line([spot,ys-4],[spot,ys+4])
                        if slot is not None: text(spot,ys+15+slot*12,label,11,'middle')
                    else:
                        line([xs-4,spot],[xs+4,spot])
                        if slot is not None: text(xs+8+slot*42,spot+4,label,11)
                # Extension lines stop around the scale numbers so a 0 is never crossed out.
                y=y1+48
                for x in (x0,x1): line([x,y1],[x,ys]);line([x,ys+31],[x,y+7])
                line([x0,y],[x1,y])
                for x in [x0,x1]: line([x-4,y-4],[x+4,y+4])
                text((x0+x1)/2,y+20,sized(horizontal),16,'middle')
                x=x0-28;line([x0,y0],[x-7,y0]);line([x0,y1],[x-7,y1]);line([x,y0],[x,y1])
                for y in [y0,y1]: line([x-4,y-4],[x+4,y+4])
                text(x-10,(y0+y1)/2,sized(vertical),16,'middle').set('transform',f'rotate(-90 {x-10} {(y0+y1)/2})')
            else:
                size_x,size_y,size_z=(_number(n) for n in bounds['size'])
                text(75,685,f'Total size: width {size_x} x depth {size_y} x height {size_z} mm (X x Y x Z)')
            directions()
            text(COLUMN_X,PARTS_TOP,'Parts in this drawing' if page_count==1 else 'Parts on this sheet',14)
            y=PARTS_TOP+22
            for size,value in columns[page]:
                if size: text(COLUMN_X,y,value,size)
                y+={13:14,11:12,0:4}[size]
            if page==0:
                for line_index,(kind,value) in enumerate(band):
                    y=FASTENER_TOP+line_index*FASTENER_LINE
                    if kind in ('header','row'):
                        for x,cell in zip((30,80,180,310,370),value): text(x,y,cell,12 if kind=='header' else 13)
                    else: text(30,y,value,14 if kind=='title' else 13)
            if source: text(30,page_height-48,f'Construction version {source["revision"]} - ID {source["artifact_id"]}',12)
            text(30,page_height-25,'Part sizes are before notches and holes, with nothing added for saw cuts. Concept only - not approved for building.',13)
            callouts(numbered[page*PARTS_PER_PAGE:(page+1)*PARTS_PER_PAGE])
        number=f'P{index}';definition=definitions[row['definition_id']]
        dims={k:definition[k] for k in ['x_mm','y_mm','z_mm','diameter_mm','outside_diameter_mm','wall_thickness_mm','length_mm'] if k in definition}
        parts.append({'number':number,'instance_id':row['id'],'definition_id':row['definition_id'],'blank_mm':dims})
    ET.register_namespace('',NS);tree.write(path,encoding='utf-8',xml_declaration=True)
    return {'dimensions':dimensions,'parts':parts,'coverage':'complete'}
