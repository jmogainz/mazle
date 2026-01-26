#!/usr/bin/env python3
"""
Remove background from SVG files using ray casting.

Algorithm: For each light-colored path, cast rays in 32 directions from each 
coordinate point. If >50% of points can reach the image border without hitting 
a dark pixel, the path is considered background and removed.

Usage: python3 remove-svg-background.py <input.svg> [output.svg]
       If output is omitted, overwrites input (backup created as input.svg.backup)
"""

import re
import math
import sys
import shutil

def get_all_coords(d_attr):
    coords = re.findall(r'(-?\d+\.?\d*),(-?\d+\.?\d*)', d_attr)
    return [(int(float(x)), int(float(y))) for x, y in coords]

def is_light_color(hex_color, threshold=180):
    r = int(hex_color[1:3], 16)
    g = int(hex_color[3:5], 16)
    b = int(hex_color[5:7], 16)
    return (r + g + b) / 3 > threshold

def remove_background(input_path, output_path=None, light_threshold=180, reach_threshold=0.5):
    """
    Remove background paths from SVG.
    
    Args:
        input_path: Path to input SVG
        output_path: Path to output SVG (default: overwrite input)
        light_threshold: Brightness threshold for "light" colors (0-255, default 180)
        reach_threshold: Fraction of points that must reach border to be removed (default 0.5)
    """
    if output_path is None:
        output_path = input_path
        # Create backup
        shutil.copy(input_path, input_path + '.backup')
        print(f"Backup created: {input_path}.backup")
    
    with open(input_path, 'r') as f:
        content = f.read()
    
    # Extract viewBox dimensions
    viewbox_match = re.search(r'viewBox="(\d+)\s+(\d+)\s+(\d+)\s+(\d+)"', content)
    if viewbox_match:
        MAX_X = int(viewbox_match.group(3))
        MAX_Y = int(viewbox_match.group(4))
    else:
        MAX_X, MAX_Y = 851, 1024  # fallback
    
    path_pattern = r'<path\s+fill="(#[A-Fa-f0-9]{6})"\s+opacity="[^"]*"\s+stroke="[^"]*"\s*\n\s*d="\n([^"]*)"\s*/>'
    
    matches = list(re.finditer(path_pattern, content, re.DOTALL))
    
    # Build set of dark pixels
    dark_pixels = set()
    for m in matches:
        if not is_light_color(m.group(1), light_threshold):
            for x, y in get_all_coords(m.group(2)):
                dark_pixels.add((x, y))
    
    print(f"Dark pixels: {len(dark_pixels)}")
    
    # 32 directions for ray casting
    DIRECTIONS = [(math.cos(a * math.pi / 16), math.sin(a * math.pi / 16)) for a in range(32)]
    
    def can_reach_border(x, y):
        for dx, dy in DIRECTIONS:
            cx, cy = float(x), float(y)
            while 0 <= cx <= MAX_X and 0 <= cy <= MAX_Y:
                if (int(cx), int(cy)) in dark_pixels:
                    break
                cx += dx
                cy += dy
            else:
                return True
        return False
    
    def should_remove(d_attr):
        coords = get_all_coords(d_attr)
        if not coords:
            return False
        reach_count = sum(1 for x, y in coords if can_reach_border(x, y))
        return reach_count / len(coords) > reach_threshold
    
    # Find paths to remove
    paths_to_remove = set()
    for m in matches:
        if is_light_color(m.group(1), light_threshold) and should_remove(m.group(2)):
            paths_to_remove.add(m.start())
    
    # Rebuild content without background paths
    new_content = []
    last_end = 0
    for m in matches:
        if m.start() in paths_to_remove:
            new_content.append(content[last_end:m.start()])
        else:
            new_content.append(content[last_end:m.end()])
        last_end = m.end()
    new_content.append(content[last_end:])
    
    result = re.sub(r'\n{3,}', '\n', ''.join(new_content))
    
    with open(output_path, 'w') as f:
        f.write(result)
    
    remaining = len(re.findall(r'<path\s+fill="(#[A-Fa-f0-9]{6})"', result))
    print(f"Removed {len(paths_to_remove)} background paths")
    print(f"Remaining paths: {remaining}")
    print(f"Output: {output_path}")
    
    return len(paths_to_remove), remaining

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None
    
    remove_background(input_path, output_path)
