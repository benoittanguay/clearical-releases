#!/usr/bin/env python3
"""
Creates a professional DMG background image with drag-to-install arrow
"""

from PIL import Image, ImageDraw, ImageFont
import os

# DMG window dimensions
WIDTH = 540
HEIGHT = 380

# Icon positions (from package.json dmg.contents)
APP_X = 130
APP_Y = 220
APPLICATIONS_X = 410
APPLICATIONS_Y = 220

# Colors
BG_COLOR = (248, 248, 248)  # Light gray background
ARROW_COLOR = (120, 120, 120)  # Medium gray for arrow
TEXT_COLOR = (100, 100, 100)  # Slightly darker for text

def draw_arrow(draw, start_x, start_y, end_x, end_y, color, width=3):
    """Draw an arrow from start to end point"""
    import math

    # Draw the main line
    draw.line([(start_x, start_y), (end_x, end_y)], fill=color, width=width)

    # Calculate arrowhead
    angle = math.atan2(end_y - start_y, end_x - start_x)
    arrow_length = 15
    arrow_angle = math.pi / 6  # 30 degrees

    # Arrowhead points
    x1 = end_x - arrow_length * math.cos(angle - arrow_angle)
    y1 = end_y - arrow_length * math.sin(angle - arrow_angle)
    x2 = end_x - arrow_length * math.cos(angle + arrow_angle)
    y2 = end_y - arrow_length * math.sin(angle + arrow_angle)

    # Draw arrowhead
    draw.polygon([(end_x, end_y), (x1, y1), (x2, y2)], fill=color)

def create_dmg_background():
    # Create image with light background
    img = Image.new('RGB', (WIDTH, HEIGHT), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # Add subtle gradient effect (darker at bottom)
    for y in range(HEIGHT):
        gray_value = int(248 - (y / HEIGHT) * 10)
        for x in range(WIDTH):
            if img.getpixel((x, y)) == BG_COLOR:
                img.putpixel((x, y), (gray_value, gray_value, gray_value))

    draw = ImageDraw.Draw(img)

    # Calculate arrow position (between the two icons, slightly above)
    arrow_y = APP_Y - 10
    arrow_start_x = APP_X + 50  # Right of app icon
    arrow_end_x = APPLICATIONS_X - 50  # Left of Applications icon

    # Draw the arrow
    draw_arrow(draw, arrow_start_x, arrow_y, arrow_end_x, arrow_y, ARROW_COLOR, width=3)

    # Try to use system font for text
    try:
        # Try various font paths
        font_paths = [
            "/System/Library/Fonts/Helvetica.ttc",
            "/System/Library/Fonts/SFNS.ttf",
            "/System/Library/Fonts/SFNSText.ttf",
            "/Library/Fonts/Arial.ttf",
        ]
        font = None
        for fp in font_paths:
            if os.path.exists(fp):
                try:
                    font = ImageFont.truetype(fp, 13)
                    break
                except:
                    continue
        if font is None:
            font = ImageFont.load_default()
    except:
        font = ImageFont.load_default()

    # Add "Drag to install" text below arrow
    text = "Drag to Applications"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_x = (WIDTH - text_width) // 2
    text_y = arrow_y + 15

    draw.text((text_x, text_y), text, fill=TEXT_COLOR, font=font)

    # Save the image
    output_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    output_path = os.path.join(output_dir, "build", "dmg-background.png")

    # Also create @2x version for Retina displays
    img.save(output_path, "PNG")
    print(f"Created: {output_path}")

    # Create @2x version (double resolution)
    img_2x = img.resize((WIDTH * 2, HEIGHT * 2), Image.Resampling.LANCZOS)
    output_path_2x = os.path.join(output_dir, "build", "dmg-background@2x.png")
    img_2x.save(output_path_2x, "PNG")
    print(f"Created: {output_path_2x}")

if __name__ == "__main__":
    create_dmg_background()
