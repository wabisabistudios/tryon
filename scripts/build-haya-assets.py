"""Crop Haya's approved guide posters into web-ready UI assets."""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path("/home/ubuntu/.cursor/projects/workspace/assets")
OUT = ROOT / "public" / "assets" / "haya"

POSTERS = {
    "shape": SOURCE / "19170f4b-23f1-411f-ad34-c463f66801ff.png",
    "design": SOURCE / "8bf50541-7587-4eff-941a-2374fcfaa980.png",
    "rules": SOURCE / "a14a3547-3615-4df2-9dd9-a7838fd7c8ca.png",
    "colour": SOURCE / "439b315f-57e0-41d3-b6b1-4f6cc26ea60b.png",
}


def save_crop(source, box, destination, size=None):
    image = Image.open(source).convert("RGB").crop(box)
    if size:
        image.thumbnail(size, Image.Resampling.LANCZOS)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, "WEBP", quality=88, method=6)


def crop_shape_cards():
    xs = [(17, 173), (175, 331), (333, 489), (491, 647), (649, 805)]
    rows = [(250, 509), (511, 769)]
    names = [
        ("round", 0, 0), ("oval", 1, 0), ("squoval", 2, 0),
        ("square", 3, 0), ("almond", 4, 0), ("coffin", 0, 1),
        ("stiletto", 1, 1), ("lipstick", 2, 1), ("natural", 3, 1),
        ("toes", 4, 1),
    ]
    for name, col, row in names:
        top = rows[row][0]
        save_crop(
            POSTERS["shape"],
            (xs[col][0] + 5, top + 7, xs[col][1] - 5, top + 151),
            OUT / "shapes" / f"{name}.webp",
            (310, 400),
        )

    # Individual length references from the bottom strip.
    x_ranges = [(15, 86), (87, 159), (160, 232), (233, 305),
                (306, 378), (379, 451), (452, 525)]
    length_names = ["natural", "xs", "s", "m", "l", "xl", "xxl"]
    for name, (left, right) in zip(length_names, x_ranges):
        save_crop(
            POSTERS["shape"],
            (left, 825, right, 918),
            OUT / "lengths" / f"{name}.webp",
            (180, 300),
        )


def crop_design_cards():
    xs = [(13, 172), (174, 332), (334, 491), (493, 649), (651, 806)]
    rows = [(271, 495), (497, 711), (713, 941)]
    names = [
        ("plain", 0, 0), ("french", 1, 0), ("jelly", 2, 0),
        ("glitter", 3, 0), ("cateye", 4, 0), ("ombre", 0, 1),
        ("chrome", 1, 1), ("marble", 2, 1), ("minimal", 3, 1),
        ("3d", 4, 1), ("4d", 0, 2), ("charms", 1, 2),
        ("reference", 2, 2), ("toeart", 3, 2), ("length-guide", 4, 2),
    ]
    for name, col, row in names:
        top = rows[row][0]
        save_crop(
            POSTERS["design"],
            (xs[col][0] + 4, top + 34, xs[col][1] - 4, top + 150),
            OUT / "designs" / f"{name}.webp",
            (320, 360),
        )


def crop_rule_cards():
    # Eight service-flow columns.
    for index in range(8):
        left = 5 + index * 105
        save_crop(
            POSTERS["rules"],
            (left, 225, min(left + 104, 850), 589),
            OUT / "flow" / f"step-{index + 1}.webp",
            (220, 500),
        )

    # Eight quick-rule cards (4 columns x 2 rows).
    for row, y in enumerate(((603, 785), (787, 956))):
        for col in range(4):
            left = 7 + col * 210
            save_crop(
                POSTERS["rules"],
                (left, y[0], min(left + 207, 850), y[1]),
                OUT / "rules" / f"rule-{row * 4 + col + 1}.webp",
                (420, 360),
            )


def crop_colour_chips():
    # family: (prefix, count, left, top, right, bottom)
    families = {
        "nude": ("N", 16, 16, 181, 1009, 294),
        "pink": ("P", 16, 16, 296, 1009, 407),
        "red": ("R", 10, 16, 409, 551, 519),
        "orange": ("O", 7, 554, 409, 1009, 519),
        "green": ("G", 5, 16, 521, 268, 635),
        "blue": ("B", 5, 270, 521, 526, 635),
        "purple": ("PU", 5, 528, 521, 760, 635),
        "brown": ("BR", 5, 762, 521, 1009, 635),
        "glitter": ("GL", 5, 16, 637, 268, 759),
        "shimmer": ("SP", 5, 270, 637, 526, 759),
        "metallic": ("M", 5, 528, 637, 760, 759),
        "cateye": ("CE", 5, 762, 637, 1009, 759),
        "jelly": ("J", 5, 16, 761, 268, 887),
        "marble": ("MB", 5, 270, 761, 526, 887),
        "neon": ("NE", 5, 528, 761, 760, 887),
        "special": ("S", 5, 762, 761, 1009, 887),
    }
    for family, (prefix, count, left, top, right, bottom) in families.items():
        cell_width = (right - left) / count
        for index in range(count):
            x1 = int(left + index * cell_width)
            x2 = int(left + (index + 1) * cell_width)
            code = f"{prefix}{index + 1:02d}"
            save_crop(
                POSTERS["colour"],
                (x1, top + 22, x2, bottom - 18),
                OUT / "colours" / family / f"{code}.webp",
                (150, 230),
            )


def copy_full_guides():
    for name, source in POSTERS.items():
        save_crop(
            source,
            (0, 0, Image.open(source).width, Image.open(source).height),
            OUT / "guides" / f"{name}.webp",
            (1400, 1400),
        )


if __name__ == "__main__":
    crop_shape_cards()
    crop_design_cards()
    crop_rule_cards()
    crop_colour_chips()
    copy_full_guides()
    print(f"Built Haya image assets in {OUT}")
