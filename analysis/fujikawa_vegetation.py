"""Bake small seamless ground textures and an alpha atlas for Fujikawa's summer verges."""
from pathlib import Path

import cv2
import numpy as np

OUT = Path(__file__).resolve().parents[1] / 'assets' / 'fujikawa'


def mottling(rng, size, scale):
    # Blur a periodic random field so its edges match when Three.js repeats it.
    noise = rng.normal(0, 1, (size, size)).astype('f')
    tiled = np.tile(noise, (3, 3))
    blurred = cv2.GaussianBlur(tiled, (0, 0), scale)[size:size*2, size:size*2]
    return blurred / max(.001, blurred.std())


def mown_surface():
    """A 4.2 × 5.2 m tile of bent leaves, dry clippings and darker turf crowns."""
    rng = np.random.default_rng(492)
    size = 512
    pockets = mottling(rng, size, 24)
    crowns = mottling(rng, size, 5)
    speckle = mottling(rng, size, 1.2)
    straw = np.clip((.8 * pockets + .5 * crowns - .28) / 2.1, 0, 1)
    shade = 6 * pockets + 11 * crowns + 4 * speckle
    bgr = np.array([46, 94, 79]) + shade[:, :, None] * [.47, .91, 1.05]
    bgr += straw[:, :, None] * [7, 11, 24]
    # Contrasting windrows of cuttings bridge the gap between individual
    # blades and the mowing passes that are painted on the full mesh.
    yy, xx = np.ogrid[:size, :size]
    cuttings = np.zeros((size, size), np.float32)
    for _ in range(180):
        x, y = rng.uniform(0, size, 2)
        a = rng.normal(.47, .64)
        dx = (xx - x + size/2) % size - size/2
        dy = (yy - y + size/2) % size - size/2
        along = (dx*np.cos(a) + dy*np.sin(a)) / rng.uniform(6, 19)
        across = (dy*np.cos(a) - dx*np.sin(a)) / rng.uniform(1.2, 3.9)
        cuttings += rng.uniform(.4, 1) * np.exp(-1.3*(along*along + across*across))
    bgr += cuttings[:, :, None] * np.array([11, 18, 29])
    # The tips lie in loose sprays. Wrap strokes that cross a seam.
    for _ in range(1700):
        x, y = rng.uniform(0, size, 2)
        dry = straw[int(y), int(x)]
        angle = rng.uniform(-np.pi, np.pi)
        for _ in range(rng.integers(5, 15)):
            theta = angle + rng.normal(0, .52)
            length = rng.uniform(3, 14)
            start = np.array([x, y]) + rng.normal(0, 2.1, 2)
            end = start + length * np.array([np.cos(theta), np.sin(theta)])
            tone = rng.uniform(-17, 27) + 10 * dry
            pixel = bgr[int(start[1]) % size, int(start[0]) % size]
            colour = tuple(np.clip(pixel + tone * np.array([.48, .85, 1]), 18, 180))
            for step in np.linspace(0, 1, int(length) + 1):
                i, j = np.rint(start + step * (end - start)).astype(int) % size
                bgr[j, i] = colour
    cv2.imwrite(str(OUT/'mown-grass.webp'), np.uint8(np.clip(bgr, 0, 255)),
                [cv2.IMWRITE_WEBP_QUALITY, 90])


def scrub_surface():
    rng = np.random.default_rng(312)
    size = 256
    coarse = mottling(rng, size, 12)
    fine = mottling(rng, size, 2)
    mid = np.array([42, 78, 52])
    field = mid + ((6*coarse + 5*fine)[:, :, None] * np.array([.64,1,.95]))
    # Green tips catch light; small cool recesses remain between adjacent sprays.
    for _ in range(13500):
        x,y = rng.integers(size, size=2)
        tint = rng.normal(1, .21)
        colour = np.clip(field[y,x]*tint, 9, 157)
        dx,dy = rng.integers(-2,3),rng.integers(-4,2)
        for t in (0, .33, .66, 1):
            field[round(y+dy*t)%size,round(x+dx*t)%size] = colour
    cv2.imwrite(str(OUT/'scrub-surface.webp'), field.clip(0,255).astype('uint8'), [cv2.IMWRITE_WEBP_QUALITY,92])


def plant_card(form, seed):
    rng = np.random.default_rng(seed)
    s = 256
    rgba = np.zeros((s,s,4), np.uint8)
    if form == 'brush':
        # Irregular clusters of branching leafy sprays, wider than a single shrub.
        for spray in range(280):
            depth = spray/280
            cx = rng.uniform(17,239)
            shade = .56 + .43*depth
            spread = .52 + .48*np.sin(cx/257*4.2+.32)**2
            h = rng.uniform(60,200)*spread
            base = np.array([cx+rng.uniform(-15,15), 254.])
            tip = np.array([cx+rng.uniform(-27,27), 254-h])
            wood = (int(30*shade),int(49*shade),int(49*shade),255)
            cv2.line(rgba,tuple(base.astype(int)),tuple(tip.astype(int)),wood,1,cv2.LINE_AA)
            for k in range(15):
                along = rng.uniform(.16,1)
                node = base+(tip-base)*along
                side = (-1 if k%2 else 1)*rng.uniform(5,22)*(1.16-along*.55)
                branch = node + np.array([side,rng.uniform(-13,-3)])
                cv2.line(rgba,tuple(node.astype(int)),tuple(branch.astype(int)),wood,1)
                for _ in range(5):
                    pos = branch+rng.normal(0,[4.4,3.1])
                    variation = rng.uniform(-11,16) + 19*along
                    c = ((np.array([37,80,48])+variation)*shade).astype(int)
                    cv2.ellipse(rgba,tuple(pos.astype(int)),(int(rng.integers(2,5)),int(rng.integers(1,3))),
                                rng.uniform(-75,60),0,360,tuple(int(n) for n in c)+(255,),-1,cv2.LINE_AA)
    else:
        # Fine grass blades and the longer, arching stems and panicles of reeds.
        for stem in range(310 if form=='grass' else 190):
            x = rng.uniform(12,244)
            y = rng.uniform(246,259)
            base = np.array([x,y])
            height = rng.uniform(20,232) * (.72+.28*np.sin(.045*x))
            lean = rng.uniform(-37,37)
            tip = base + np.array([lean,-height])
            elbow = base + np.array([lean*.27,-height*.64])
            base_colour = np.array([42,86,69]) if form=='grass' else np.array([47,91,76])
            colour = (base_colour+rng.uniform(-16,25))*(.67+.32*stem/(310 if form=='grass' else 190))
            c = tuple(int(n) for n in colour)+(255,)
            w = rng.uniform(1,3)
            pts = np.array([base+[-w,0],elbow+[-.6*w,0],tip,elbow+[.6*w,0],base+[w,0]],np.int32)
            cv2.fillPoly(rgba,[pts],c,cv2.LINE_AA)
            if form=='reed' and height>84:
                leaf = elbow+np.array([rng.uniform(10,31)*np.sign(lean),rng.uniform(-29,-7)])
                cv2.fillPoly(rgba,[np.array([elbow,elbow+[3,-10],leaf],np.int32)],c,cv2.LINE_AA)
                if stem%5==0:
                    cv2.line(rgba,tuple(tip.astype(int)),tuple((tip+[lean*.13,-8]).astype(int)),(91,127,126,226),2,cv2.LINE_AA)
    # Give mipmaps the nearby foliage colour wherever a texel is transparent.
    rgb = rgba[:,:,:3]
    for _ in range(5):
        rgb = np.where(np.any(rgb>0,axis=2)[:,:,None],rgb,cv2.dilate(rgb,np.ones((3,3),np.uint8)))
    rgba[:,:,:3] = rgb
    return rgba


def bake():
    mown_surface()
    scrub_surface()
    cards = [plant_card(form, seed) for form,seed in
             [('grass',12),('reed',71),('brush',101),('brush',202)]]
    # Keep mapped low bushes at their original locations but use the branched
    # silhouettes visible in the flight video for the smaller crowns.
    cv2.imwrite(str(OUT/'shrubs.png'), cards[2])
    atlas = np.hstack(cards)
    cv2.imwrite(str(OUT/'verge-plants.webp'),atlas,[cv2.IMWRITE_WEBP_QUALITY,89])


if __name__ == '__main__':
    bake()
