"""Build the offline Fujikawa terrain with numpy and opencv-python."""
import concurrent.futures
import json
import math
import time
import urllib.error
import urllib.request
from pathlib import Path

import cv2
import numpy as np

from fujikawa_vegetation import bake as bake_verge_textures

LAT, LON = 35.120833, 138.631667
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'fujikawa'
AUTHORING = ROOT / '.cache' / 'fujikawa' / 'survey'
CACHE = ROOT / '.cache' / 'fujikawa' / 'tiles'
BASE = 'https://cyberjapandata.gsi.go.jp/xyz/'
SEA_BGR = (94, 82, 56)
METRES_PER_WORLD = 40075016.686 * math.cos(math.radians(LAT))
CX = (LON + 180) / 360
CY = (1 - math.asinh(math.tan(math.radians(LAT))) / math.pi) / 2
# Pixel coordinates on the north-up z17 mosaic starting at tile (116007,51860).
SOUTH = ((116007 + 910/256)/2**17, (51860 + 1335/256)/2**17)
BEARING = math.atan2(757-910, 1335-480)
THRESHOLD = ((SOUTH[0]-CX)*METRES_PER_WORLD, (SOUTH[1]-CY)*METRES_PER_WORLD)
FIELD_ALTITUDE = 6


def tile(layer, zoom, x, y):
    suffix = 'jpg' if layer == 'seamlessphoto' else 'png'
    path = CACHE / f'{layer}-{zoom}-{x}-{y}.{suffix}'
    absent = path.with_suffix('.missing')
    if absent.exists():
        return None
    if not path.exists():
        url = f'{BASE}{layer}/{zoom}/{x}/{y}.{suffix}'
        for attempt in range(3):
            try:
                with urllib.request.urlopen(url, timeout=30) as response:
                    path.write_bytes(response.read())
                break
            except urllib.error.HTTPError as error:
                if error.code == 404:
                    absent.touch()
                    return None
                if error.code < 500 or attempt == 2:
                    raise
                time.sleep(1 + attempt)
    image = cv2.imread(str(path))
    if image is None or image.shape != (256, 256, 3):
        raise ValueError(path)
    return image


def mosaic(layer, zoom, x0, y0, width, height):
    photo = layer == 'seamlessphoto'
    nodata = np.nan if layer == 'dem5a_png' else 0
    shape = (256*height, 256*width)
    output = np.empty((*shape, 3), np.uint8) if photo else np.zeros(shape, np.float32)

    def fill(offset):
        x, y = offset
        image = tile(layer, zoom, x0+x, y0+y)
        block = output[y*256:(y+1)*256, x*256:(x+1)*256]
        if image is None:
            block[:] = SEA_BGR if photo else nodata
        elif photo:
            # No photography offshore. Tiles can also have black, unphotographed corners.
            block[:] = np.where((image.max(axis=2) < 8)[:, :, None], SEA_BGR, image)
        else:
            b, g, r = cv2.split(image.astype(np.int32))
            raw = (r*256 + g)*256 + b
            valid = raw != 0x800000
            raw[raw >= 0x800000] -= 0x1000000
            block[:] = np.where(valid, raw*.01, nodata)

    offsets = [(x, y) for x in range(width) for y in range(height)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        list(pool.map(fill, offsets))
    return output


def bake(name, zoom, nx, ny, dem_zoom, resolution, grid, center=None):
    scale = 2**zoom
    cx, cy = CX, CY
    if center:
        lat, lon = center
        cx = (lon+180)/360
        cy = (1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2
    x0, y0 = round(cx*scale - nx/2), round(cy*scale - ny/2)
    photo = mosaic('seamlessphoto', zoom, x0, y0, nx, ny)
    resized = cv2.resize(photo, (resolution*nx, resolution*ny), interpolation=cv2.INTER_AREA)

    factor = 2**(dem_zoom-zoom)
    xx, yy = np.meshgrid(np.linspace(x0, x0+nx, grid+1), np.linspace(y0, y0+ny, grid+1))
    # Expand by half a DEM pixel so bilinear sampling includes both sides of an edge.
    xmin, ymin = math.floor(x0*factor-.5/256), math.floor(y0*factor-.5/256)
    xmax, ymax = math.floor((x0+nx)*factor+.5/256), math.floor((y0+ny)*factor+.5/256)
    heights = mosaic('dem_png', dem_zoom, xmin, ymin, xmax-xmin+1, ymax-ymin+1)
    px, py = (xx*factor-xmin)*256-.5, (yy*factor-ymin)*256-.5
    elevation = cv2.remap(heights, px.astype('f'), py.astype('f'), cv2.INTER_LINEAR)
    if name == 'runway':
        # Airborne-laser DEM5A resolves the flood levee and the revetment.
        # DEM10B remains available on water and at the edge of laser coverage.
        factor5 = 2**(15-zoom)
        x5, y5 = math.floor(x0*factor5-.5/256), math.floor(y0*factor5-.5/256)
        w5 = math.floor((x0+nx)*factor5+.5/256)-x5+1
        h5 = math.floor((y0+ny)*factor5+.5/256)-y5+1
        laser = mosaic('dem5a_png', 15, x5, y5, w5, h5)
        high = cv2.remap(laser, ((xx*factor5-x5)*256-.5).astype('f'),
                         ((yy*factor5-y5)*256-.5).astype('f'), cv2.INTER_LINEAR)
        elevation = np.where(np.isfinite(high), high, elevation)
    if name == 'fuji':
        # Use the source DEM at the image resolution to keep ravines, crater walls
        # and the isolated modeled spring/summer snow patches legible from the river mouth.
        h, w = resized.shape[:2]
        u, v = np.meshgrid(np.linspace(px[0, 0], px[0, -1], w), np.linspace(py[0, 0], py[-1, 0], h))
        alt = cv2.remap(heights, u.astype('f'), v.astype('f'), cv2.INTER_LINEAR)
        mpp = nx*METRES_PER_WORLD/scale/w
        north_slope, east_slope = np.gradient(alt, mpp)
        slope = np.hypot(north_slope, east_slope)
        valleys = cv2.GaussianBlur(alt, (0, 0), 270/mpp) - alt
        relief = np.clip(.91 + .40*east_slope + .16*north_slope, .59, 1.06)
        snowline = 3390 + 260*slope - 4.8*valleys + 100*east_slope
        cover = np.clip((alt-snowline)/250, 0, 1)
        exposed = np.clip((slope-.58)*1.8 + (-valleys-13)/68, 0, .86)
        cover *= (1-exposed) * .60
        snow_bgr = np.array([242, 237, 225])*relief[:, :, None] + np.array([12, 6, 0])
        resized = np.clip(resized*(1-cover[:, :, None]) + snow_bgr*cover[:, :, None], 0, 255).astype('uint8')
    if not cv2.imwrite(str(OUT/(name+'.webp')), resized, [cv2.IMWRITE_WEBP_QUALITY, 84]):
        raise OSError(f'Failed to write {name}.webp')
    if name == 'runway':
        # Level the flight surface and ease the join into the surveyed riverbank.
        dx = (xx/scale-SOUTH[0])*METRES_PER_WORLD
        dz = (yy/scale-SOUTH[1])*METRES_PER_WORLD
        right = dx*math.cos(BEARING) + dz*math.sin(BEARING)
        along = dx*math.sin(BEARING) - dz*math.cos(BEARING)
        distance = np.maximum.reduce([np.abs(right)-15, -along, along-850])
        # Cover the vertices of all triangles intersecting the 30 m paved strip.
        cell_diagonal = math.hypot(nx, ny)*METRES_PER_WORLD/(scale*grid)
        blend = np.clip((distance-cell_diagonal)/25, 0, 1)
        elevation = FIELD_ALTITUDE + blend*(elevation-FIELD_ALTITUDE)
    np.rint(elevation*5).astype('<i2').tofile(AUTHORING/(name+'.bin'))
    west, east = (xx[0, [0, -1]]/scale-CX)*METRES_PER_WORLD
    north, south = (yy[[0, -1], 0]/scale-CY)*METRES_PER_WORLD
    return dict(name=name, width=grid+1, height=grid+1, bounds=[west, north, east, south],
                photoZoom=zoom, demZoom=dem_zoom)


def bake_pavement():
    # Rectify the real road surface so it can be sampled close to the wheels.
    photo = cv2.imread(str(OUT / 'runway.webp'))
    width, height = 192, 4096
    along = np.linspace(850, 0, height)[:, None]
    across = np.linspace(-15, 15, width)[None, :]
    mpp = METRES_PER_WORLD / (2**17 * 256)
    px = 910 + (along*math.sin(BEARING) + across*math.cos(BEARING))/mpp
    py = 1335 + (-along*math.cos(BEARING) + across*math.sin(BEARING))/mpp
    road = cv2.remap(photo, px.astype('f'), py.astype('f'), cv2.INTER_CUBIC)
    # Preserve broad patches in the pavement. Remove faded paint from the base so
    # the markings can be drawn once, at their measured positions.
    grey = cv2.cvtColor(road, cv2.COLOR_BGR2GRAY)
    grey = cv2.morphologyEx(grey, cv2.MORPH_OPEN, np.ones((29, 13), np.uint8))
    grey = cv2.GaussianBlur(grey, (9, 17), 2).astype('f')
    rng = np.random.default_rng(36)
    grain = rng.normal(0, 3.0, grey.shape)
    base = 71 + .46*(grey-np.median(grey)) + grain
    margin = np.clip((np.abs(across)-14.50)*2, 0, 1)
    surface = np.clip(base[:, :, None] + np.array([2, 1, 0]) + 13*margin[:, :, None], 0, 255)
    paint = np.zeros((height, width), np.uint8)

    def pixel(right, forward):
        return (round((right/30 + .5)*(width-1)), round((1-forward/850)*(height-1)))

    def rectangle(right, start, stripe_width, length):
        cv2.rectangle(paint, pixel(right-stripe_width/2, start+length),
                      pixel(right+stripe_width/2, start), 255, -1)

    # GSI photograph and JTSB AI2013-4-2, figure 1: dashed centre, threshold
    # bars, opposing designators and paired groups on the northern approach.
    for forward in (3.0, 842.0):
        for right in (-8.75, -5.25, -1.75, 1.75, 5.25, 8.75):
            rectangle(right, forward, 1.40, 5)
    for forward in range(87, 800, 50):
        rectangle(0, forward, .65, 30)
    for forward in (419, 423, 427):
        for right in (-11.8, 11.8):
            rectangle(right, forward, 4.3, .95)
    for right in (-9.5, 9.5):
        rectangle(right, 676, 2.7, 23)
    for right in (-5.4, 5.4):
        rectangle(right, 627, 1.4, 11)

    def designator(text, forward, face):
        # Strokes are rasterised in metres, stretched in the direction of travel.
        glyph = np.zeros((124, 160), np.uint8)
        font = cv2.FONT_HERSHEY_SIMPLEX
        cv2.putText(glyph, text, (6, 102), font, 3.1, 255, 11, cv2.LINE_AA)
        rows, cols = np.nonzero(glyph)
        cut = glyph[rows.min():rows.max()+1, cols.min():cols.max()+1]
        x, y = pixel(-4.6, forward+5.1)
        x2, y2 = pixel(4.6, forward-5.1)
        numerals = cv2.resize(cut, (x2-x, y2-y), interpolation=cv2.INTER_AREA)
        if face == 'south':
            numerals = cv2.rotate(numerals, cv2.ROTATE_180)
        paint[y:y2, x:x2] = numerals

    designator('36', 18.2, 'north')
    designator('18', 830, 'south')
    opacity = (paint/255)[:, :, None]
    chalk = np.clip(222 + .22*(grey-np.median(grey)) + grain, 185, 238)
    surface = surface*(1-opacity) + (chalk[:, :, None] + [0, 2, 3])*opacity
    if not cv2.imwrite(str(OUT / 'pavement.webp'), surface.astype(np.uint8),
                       [cv2.IMWRITE_WEBP_QUALITY, 92]):
        raise OSError('Failed to write pavement.webp')


def bake_grass_detail():
    # A small, repeating brightness map restores texture below the photograph's GSD.
    rng = np.random.default_rng(850)
    tile_size = 192
    field = rng.normal(128, 13, (tile_size, tile_size)).clip(0, 255).astype(np.uint8)
    for _ in range(3200):
        x, y = rng.integers(tile_size, size=2)
        dx, dy = rng.integers(-3, 4), rng.integers(-5, 2)
        tone = int(rng.integers(48, 208))
        # Wrap blades that cross an edge before automatic texture mipmapping.
        for step in np.linspace(0, 1, 6):
            field[round(y+dy*step)%tile_size, round(x+dx*step)%tile_size] = tone
    if not cv2.imwrite(str(OUT / 'grass-detail.webp'), field, [cv2.IMWRITE_WEBP_QUALITY, 93]):
        raise OSError('Failed to write grass-detail.webp')


def bake_foliage():
    # Crossed cutouts retain fine silhouettes after the leaves become subpixel.
    # Near-field low hedges have foliage down to the ground; taller riparian
    # trees have a branched trunk and a broken, less regular crown.
    size = 256
    for form in ('shrubs', 'canopy'):
        image = np.zeros((size,size,4),np.uint8)
        rng = np.random.default_rng(441 if form == 'canopy' else 606)
        tall = form == 'canopy'
        root = np.array([127.,252.])
        for _ in range(40):
            x = rng.normal(127,43)
            y = rng.uniform(61,171)
            tip = np.array([x,y])
            fork = np.array([126+rng.normal(0,3),205 if tall else 230])
            cv2.line(image,tuple(root.astype(int)),tuple(fork.astype(int)),(64,74,76,255),3)
            cv2.line(image,tuple(fork.astype(int)),tuple(tip.astype(int)),(53,65,65,255),1)
        centers = []
        for _ in range(104):
            theta = rng.uniform(0,2*math.pi)
            r = math.sqrt(rng.random())
            cx = 128+r*87*math.cos(theta)
            cy = (117 if tall else 139)+r*(76 if tall else 83)*math.sin(theta)
            # Individual sprays overlap, but retain gaps between the main boughs.
            radius = rng.uniform(11,23)
            centers.append((cx,cy,radius,rng.uniform(-15,12)))
        centers.sort(key=lambda c: -c[1]+.30*c[0])
        for cx,cy,radius,tone in centers:
            for _ in range(115):
                angle = rng.uniform(0,2*math.pi)
                r = math.sqrt(rng.random())
                dx, dy = r*radius*math.cos(angle), r*radius*math.sin(angle)
                x,y=round(cx+dx),round(cy+dy)
                shade = 1.02 - .0016*cy - .10*(dy/radius) - .05*(dx/radius)
                value = tone+rng.uniform(-13,18)
                bgr = (np.array([67,100,88])*shade + value).clip(0,255)
                cv2.ellipse(image,(x,y),(int(rng.integers(1,4)),int(rng.integers(1,3))),
                            rng.uniform(-65,65),0,360,tuple(int(v) for v in bgr)+(255,),-1)
        # Extrude edge colours into transparent texels to avoid dark filtering fringes.
        colour = image[:,:,:3]
        for _ in range(3):
            filled = cv2.dilate(colour,np.ones((3,3),np.uint8))
            colour = np.where(np.any(colour>0,axis=2)[:,:,None],colour,filled)
        image[:,:,:3] = colour
        cv2.imwrite(str(OUT/(form+'.png')),image)


def bake_landmarks():
    # Survey pixels refer to the north-up near-field mosaic displayed at 1024 px wide.
    photo = cv2.imread(str(OUT/'runway.webp'))
    image = cv2.resize(photo, (1024, 1365), interpolation=cv2.INTER_AREA)
    rng = np.random.default_rng(1335)
    stands = []

    # These polygons trace the actual hedgerows, riparian woodland and scrub.
    # Sample canopy placements only over green aerial pixels inside a traced stand.
    patches = [
        (3.6, 1.25, [(388,749),(551,725),(551,733),(392,754)]),
        (3.6, .85, [(535,610),(539,613),(590,887),(583,892),(562,783)]),
        (4.2, 2.5, [(373,608),(381,611),(403,743),(397,746)]),
        (4.5, 2.3, [(342,631),(353,632),(381,848),(370,853)]),
        (5.0, 2.4, [(416,899),(478,916),(594,895),(588,909),(477,930),(432,917)]),
        (6.5, 3.7, [(73,901),(319,892),(333,908),(44,952),(4,946),(11,914)]),
        (7.0, 4.3, [(162,254),(234,226),(248,342),(213,357),(153,344)]),
        (3.2, 1.5, [(433,151),(437,150),(467,318),(462,321)]),
        (8.5, 5.2, [(613,1),(729,0),(704,91),(713,247),(692,358),(661,277),(657,114)]),
        (7.5, 4.8, [(656,235),(698,275),(702,437),(725,593),(708,664),(678,563)]),
        (8.0, 5.3, [(928,704),(974,568),(1023,532),(1023,899),(982,918),(931,848)]),
    ]
    for spacing, nominal_height, vertices in patches:
        mask = np.zeros(image.shape[:2], np.uint8)
        cv2.fillPoly(mask, [np.array(vertices, np.int32)], 255)
        xmin, ymin, w, h = cv2.boundingRect(np.array(vertices, np.int32))
        for z in np.arange(ymin, ymin+h, spacing):
            for x in np.arange(xmin, xmin+w, spacing):
                u = round(x+rng.uniform(-.4, .4)*spacing)
                v = round(z+rng.uniform(-.4, .4)*spacing)
                if not (0 <= u < 1024 and 0 <= v < 1365 and mask[v,u]):
                    continue
                b,g,r = [float(c) for c in image[v,u]]
                if g-r < .5 or g-b < 10 or g > 164:
                    continue
                height = round(nominal_height*rng.uniform(.72, 1.37), 2)
                stands.append([u, v, height, round(height*rng.uniform(.52, .88), 2),
                               round((r+g+b)/3)])
    (AUTHORING/'trees.json').write_text(json.dumps(stands, separators=(',', ':'))+'\n')


def bake_floodplain_photo():
    """Upgrade only the final georeferenced ground image, after all z17 pixel measurements."""
    base = mosaic('seamlessphoto', 17, 116007, 51860, 6, 8)
    detail = mosaic('seamlessphoto', 18, 232016, 103722, 9, 9)
    frame = cv2.resize(base, (3072, 4096), interpolation=cv2.INTER_CUBIC)
    # The detailed sheet starts two z18 tiles east and south of the frame origin.
    x0, y0 = 512, 512
    height, width = detail.shape[:2]
    target = frame[y0:y0 + height, x0:x0 + width]
    # Outline traced on a 768 × 1024 print, between the west levee and east gravel bars.
    boundary = np.array([(204,145), (326,127), (369,151), (437,143), (540,126),
                         (675,138), (680,494), (596,628), (467,685), (340,684),
                         (310,645), (287,546), (268,452), (244,422), (221,299)])
    dry = np.zeros((height, width), np.uint8)
    cv2.fillPoly(dry, [boundary * 4 - [x0, y0]], 255)
    dry = cv2.GaussianBlur(dry, (0, 0), 8)
    water = cv2.imread(str(OUT / 'river-water.png'), cv2.IMREAD_GRAYSCALE)
    if water is None:
        raise FileNotFoundError(OUT / 'river-water.png')
    water = cv2.resize(water, (frame.shape[1], frame.shape[0]), interpolation=cv2.INTER_LINEAR)
    dry = np.minimum(dry, 255 - water[y0:y0 + height, x0:x0 + width])
    x = np.arange(width)
    y = np.arange(height)
    border = np.minimum(np.minimum(x, x[::-1])[None, :], np.minimum(y, y[::-1])[:, None])
    weight = (np.minimum(border, 24) / 24 * (dry / 255)).astype(np.float32)[:, :, None]
    target[:] = np.rint(target * (1 - weight) + detail * weight).astype(np.uint8)
    photo = cv2.resize(frame, (2048, 2731), interpolation=cv2.INTER_LANCZOS4)
    if not cv2.imwrite(str(OUT / 'runway.webp'), photo, [cv2.IMWRITE_WEBP_QUALITY, 86]):
        raise OSError('Failed to save the Fujikawa floodplain photograph')


if __name__ == '__main__':
    CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    AUTHORING.mkdir(parents=True, exist_ok=True)
    # At zoom14 and 11, 32 cells per tile place each finer tile boundary on a grid edge.
    layers = [bake('runway', 17, 6, 8, 14, 256, 176),
              bake('river', 14, 6, 6, 13, 192, 192),
              bake('mountains', 11, 6, 6, 10, 96, 192)]
    bake_pavement()
    bake_grass_detail()
    bake_landmarks()
    bake_foliage()
    bake_verge_textures()
    for outer, inner in zip(layers[1:], layers):
        outer['hole'] = inner['bounds']
    # This independent inset sits north of the river sheet and fits exactly on
    # mountain-sheet grid lines. Keep its neighbour heights for a watertight join.
    fuji = bake('fuji', 13, 5, 5, 13, 192, 176, center=(35.36, 138.73))
    layers[-1]['holes'] = [layers[-1].pop('hole'), fuji['bounds']]
    runway = dict(southThreshold=THRESHOLD, trueBearingDegrees=math.degrees(BEARING)%360,
                  length=850, width=30, elevation=FIELD_ALTITUDE)
    (OUT/'layers.json').write_text(json.dumps(dict(runway=runway, layers=layers[::-1], fuji=fuji), indent=2)+'\n')
    bake_floodplain_photo()
