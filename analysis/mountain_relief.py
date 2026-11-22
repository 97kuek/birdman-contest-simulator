"""Bake slope lighting into each venue's georeferenced photograph, before WebGL mipmapping."""
import math

import cv2
import numpy as np


# North-up square sheets. The XYZ edges coincide with the existing Blender UVs.
# name: (photograph, zoom, west, north, tiles per side, DEM zoom, output width)
SHEETS = {
    'basin': ('ort', 11, 1797, 807, 4, 11, 1024),
    'hills': ('ort', 14, 14390, 6470, 6, 14, 1536),
    'shore': ('ort', 16, 57568, 25888, 8, 14, 2048),
    'mountains': ('seamlessphoto', 11, 1810, 807, 6, 11, 1024),
    'river': ('seamlessphoto', 14, 14498, 6480, 6, 14, 1152),
    'fuji': ('seamlessphoto', 13, 7250, 3232, 5, 13, 960),
}


def bake_photo(name, mosaic, root):
    layer, zoom, x, y, side, dem_zoom, width = SHEETS[name]
    biwa = name in ('basin', 'hills', 'shore')
    folder = root / 'assets' / ('terrain' if biwa else 'fujikawa')
    image = mosaic(layer, zoom, x, y, side, side)
    scale = 2 ** (zoom - dem_zoom)
    elevation = mosaic('dem_png', dem_zoom, x // scale, y // scale, side // scale, side // scale)
    if name == 'basin':
        # Small clouds on the ortho become stationary white spots on a mountainside.
        # Use the Landsat observation at those locations only when it shows ground.
        landsat = mosaic('seamlessphoto', zoom, x, y, side, side)
        clear_ground = landsat.max(axis=2) < 145
        bright_cloud = (image.min(axis=2) > 165) & (elevation > 350)
        cloud = cv2.dilate((bright_cloud & clear_ground).astype('f'), np.ones((5, 5), np.uint8))
        weight = cv2.GaussianBlur(cloud, (0, 0), 1)[:, :, None]
        image = image * (1 - weight) + landsat * weight
    # Shade at DEM resolution. In particular, upsampling the 8 m DEM to the
    # shoreline ortho first would imprint its interpolation grid on the forest.
    lat = 35.294222 if biwa else 35.120833
    spacing = 40075016.686 * math.cos(math.radians(lat)) / (2**dem_zoom * 256)
    south, east = np.gradient(cv2.GaussianBlur(elevation, (0, 0), .8), spacing)
    valley_height = cv2.GaussianBlur(elevation, (0, 0), 210 / spacing) - elevation
    east_light, south_light = (.72 / .67, -.24 / .67) if biwa else (-35 / 62, 28 / 62)
    irradiance = (1 - east * east_light - south * south_light) / np.sqrt(1 + east**2 + south**2)
    # A concave hillside receives less skylight. Leave the coast and floodplain
    # in their photographed colours, including buildings and agricultural fields.
    vertical = elevation - (84.371 if biwa else 6)
    relief_weight = np.clip((vertical - 8) / 46, 0, 1)
    valley = np.clip(valley_height / 105, 0, 1)
    gain = 1 + relief_weight * (.66 * np.clip(irradiance - 1, -.63, .48) - .14 * valley)
    photograph = cv2.resize(image, (width, width), interpolation=cv2.INTER_AREA).astype('f')
    if name == 'fuji':
        # Summer snow retained in measured gullies below the summit.
        slope = np.hypot(south, east)
        snowline = 3390 + 260*slope - 4.8*valley_height + 100*east
        exposed = np.clip((slope - .58)*1.8 + (-valley_height - 13)/68, 0, .86)
        cover = np.clip((elevation - snowline)/250, 0, 1) * (1 - exposed) * .60
        cover = cv2.resize(cover, (width, width), interpolation=cv2.INTER_AREA)[:, :, None]
        photograph = photograph*(1 - cover) + np.array([244, 238, 225])*cover
    gain = cv2.resize(gain, (width, width), interpolation=cv2.INTER_LINEAR)
    output = np.clip(photograph * gain[:, :, None], 0, 255).astype('uint8')
    path = folder / (name + '.webp')
    if not cv2.imwrite(str(path), output, [cv2.IMWRITE_WEBP_QUALITY, 84]):
        raise OSError(path)
