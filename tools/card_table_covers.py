"""Original text-free SVG covers for the ten card-table editions (16:9)."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'games/declarative/card-table'
COLORS={'H':'#ef4444','D':'#ef4444','S':'#20312b','C':'#20312b'}
def symbol(s,x,y,size=26,color=None):
    paths={'H':'M0 9 C-28 -7 -28 -29 -13 -29 C-5 -29 0 -22 0 -18 C0 -22 5 -29 13 -29 C28 -29 28 -7 0 9Z','S':'M0 -30 C-8 -18 -29 -6 -24 7 C-20 19 -5 16 -2 8 L-8 25 H8 L2 8 C5 16 20 19 24 7 C29 -6 8 -18 0 -30Z','D':'M0 -31 L23 0 L0 31 L-23 0Z','C':'M0 -23 A13 13 0 1 0 -7 -1 A13 13 0 1 0 -2 17 L-8 29 H8 L2 17 A13 13 0 1 0 7 -1 A13 13 0 1 0 0 -23Z'}
    return f'<path d="{paths[s]}" fill="{color or COLORS[s]}" transform="translate({x} {y}) scale({size/60})"/>'
def card(x,y,s='S',count=1,back=False,scale=1,rotate=0):
    art='<rect x="-55" y="-77" width="110" height="154" rx="12" fill="'+('#17324f' if back else '#fffdf3')+'" stroke="#20312b" stroke-width="5"/>'
    if back:art+='<rect x="-43" y="-65" width="86" height="130" rx="6" fill="none" stroke="#94a3b8" stroke-width="3"/><path d="M0 -35 24 0 0 35 -24 0Z" fill="#56c9b4"/>'
    else:
        spots={1:[(0,0)],2:[(0,-35),(0,35)],3:[(0,-42),(0,0),(0,42)],4:[(-24,-38),(24,-38),(-24,38),(24,38)],8:[(a,b) for a in (-24,24) for b in (-51,-17,17,51)],10:[(a,b) for a in (-24,24) for b in (-54,-27,0,27,54)]}[count]
        art+=''.join(symbol(s,a,b,54 if count==1 else 29) for a,b in spots)
    return f'<g transform="translate({x} {y}) rotate({rotate}) scale({scale})">{art}</g>'
def chips(x,y):
    return ''.join(f'<g transform="translate({x+i*25} {y-i*9})"><ellipse rx="35" ry="13" fill="{color}" stroke="#20312b" stroke-width="4"/><ellipse cy="-7" rx="35" ry="13" fill="{color}" stroke="#20312b" stroke-width="4"/><ellipse cy="-7" rx="21" ry="7" fill="none" stroke="#fffdf3" stroke-width="3"/></g>' for i,color in enumerate(('#ef4444','#ffe143','#ef4444')))
def cover(kind):
    # Match the live catalog's flat board illustrations, cream pieces, dark
    # outlines and solid game-specific backgrounds; no inset decorative frame.
    bg={'war':'#10213a','concentration':'#334155','quoridor':'#e2c08d','michigan':'#0b5136'}.get(kind,'#0b5136')
    art=f'<rect width="800" height="450" fill="{bg}"/>'
    if kind=='six-card-golf':
        for row in range(2):
            for col in range(3):art+=card(280+col*120,135+row*178,'H' if col==0 else 'C',2 if col==0 else 3,back=col==2 or (row==0 and col==1),scale=.92)
    elif kind=='war':
        art+=card(250,218,back=True,rotate=-10)+card(292,215,'S',10,rotate=-5)+card(550,218,back=True,rotate=10)+card(508,215,'H',1,rotate=5)
    elif kind=='crazy-eights':
        art+=card(285,245,'C',3,rotate=-23)+card(350,222,'D',4,rotate=-10)+card(420,215,'H',8)+card(490,235,back=True,rotate=16)
        art+=''.join(symbol(s,x,93,52,'#fffdf3' if s in 'CS' else '#ef4444') for s,x in zip('CDSH',[290,365,440,515]))
    elif kind=='hearts':
        art+=card(260,230,'S',1,rotate=-16)+card(400,219,'H',1)+card(540,230,'H',3,rotate=16)
    elif kind=='michigan':
        for row,s in enumerate('CDHS'):
            art+=symbol(s,143,87+row*94,43,'#fffdf3' if s in 'CS' else '#ef4444')
            for col in range(5):art+=card(247+col*86,87+row*94,s,[1,2,3,4,8][col],scale=.52)
    elif kind=='quoridor':
        art+='<rect x="190" y="15" width="420" height="420" rx="8" fill="#a78050"/>'
        for r in range(9):
            for c in range(9):art+=f'<rect x="{204+c*44}" y="{29+r*44}" width="38" height="38" rx="3" fill="#e2c08d"/>'
        for x,y,w,h in [(240,157,83,8),(372,289,83,8),(460,113,8,83),(284,289,8,83)]:art+=f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="2" fill="#493520"/>'
        for x,y,color in [(400,356,'#fffdf3'),(444,92,'#20312b')]:art+=f'<circle cx="{x}" cy="{y}" r="17" fill="{color}" stroke="#20312b" stroke-width="4"/>'
    elif kind=='concentration':
        for r in range(4):
            for c in range(4):art+=card(260+c*95,69+r*104,'H',1,back=(r,c) not in [(0,1),(2,2)],scale=.57)
    elif kind=='casino-war':art+=card(255,206,'H',1,rotate=-7)+card(535,206,'S',10,rotate=7)+chips(350,360)
    elif kind=='old-maid':
        art+=card(260,248,'C',2,rotate=-22)+card(334,219,'D',2,rotate=-9)+card(470,219,'S',3,rotate=9)+card(544,248,'H',3,rotate=22)+card(400,218,'H',1)
        art+='<path d="M366 171 L370 145 387 157 400 136 413 157 430 145 434 171Z" fill="#d7aa54" stroke="#8c583a" stroke-width="2"/><circle cx="400" cy="198" r="15" fill="#eecb97"/>'
    elif kind=='blackjack':art+=card(330,213,'S',1,rotate=-10)+card(464,213,'D',10,rotate=10)+chips(365,370)
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450">'+art+'</svg>'
def attach(package,kind):
    svg=cover(kind);folder=ROOT/'covers';folder.mkdir(exist_ok=True);(folder/(kind+'.svg')).write_text(svg+'\n')
    package['images'][0]={'caption':package['name']+' cover','svg':svg}
