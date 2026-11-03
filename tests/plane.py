from PIL import Image, ImageDraw, ImageFilter
import numpy as np, sys
def draw(W=1280,H=720,cx=640,cy=360,L=900,blur=0):
    im=Image.new('RGB',(W,H))
    px=np.zeros((H,W,3),np.uint8)
    for y in range(H): px[y]=[int(110+60*y/H),int(160+50*y/H),int(230+20*y/H)]
    im=Image.fromarray(px); d=ImageDraw.Draw(im)
    s=L/900
    def P(pts): return [(cx+x*s,cy+y*s) for x,y in pts]
    body=(235,238,242); dark=(120,125,135)
    # fuselage
    d.rounded_rectangle([cx-430*s,cy-38*s,cx+400*s,cy+38*s],radius=38*s,fill=body,outline=dark,width=max(1,int(2*s)))
    d.polygon(P([(380,-38),(450,-5),(450,5),(380,38)]),fill=body)  # nose
    # tail fin
    d.polygon(P([(-330,-30),(-430,-200),(-470,-200),(-430,-30)]),fill=(30,60,150))
    # horizontal stabilizer
    d.polygon(P([(-380,0),(-470,-12),(-470,12)]),fill=dark)
    # wing (seen from side, slightly below)
    d.polygon(P([(80,20),(-120,20),(-200,95),(-150,95)]),fill=(200,204,210),outline=dark)
    # engine
    d.ellipse(P([(-40,45),(60,85)]),fill=(180,184,190),outline=dark)
    # windows
    for i in range(-300,330,26): d.rectangle(P([(i,-14),(i+12,-4)]),fill=(40,45,60))
    d.polygon(P([(395,-24),(425,-12),(400,-12)]),fill=(40,45,60))
    # stripe
    d.rectangle(P([(-430,8),(400,14)]),fill=(30,60,150))
    # gear
    d.rectangle(P([(-60,38),(-50,70)]),fill=dark); d.ellipse(P([(-70,62),(-40,88)]),fill=(30,30,30))
    d.rectangle(P([(300,38),(306,62)]),fill=dark); d.ellipse(P([(292,56),(314,76)]),fill=(30,30,30))
    if blur: im=im.filter(ImageFilter.GaussianBlur(blur))
    return im
if __name__=='__main__':
    from ai_edge_litert.interpreter import Interpreter
    i=Interpreter('/home/claude/skyhunt/web/models/efficientdet.tflite'); i.allocate_tensors()
    for L,blur in [(900,0),(600,0),(300,0),(120,0),(900,6)]:
        im=draw(L=L,blur=blur).resize((320,320))
        i.set_tensor(i.get_input_details()[0]['index'],np.array(im)[None]); i.invoke()
        o=[i.get_tensor(d['index']) for d in i.get_output_details()]
        print(L,blur,'class',o[1][0][:3],'score',o[2][0][:3].round(3))
    draw().save('plane_big.png')
