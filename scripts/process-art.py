#!/usr/bin/env python3
"""把 art-src/raw/<类别>/<id>/<状态>.png 处理成 public/art/<类别>/<id>/<状态>.webp。

- 透明图：裁掉四周的透明边（这样立绘的底边就是脚底，便于按底部对齐），再按类别缩小。
- 背景图：裁成 16:9 并缩到 1920 宽。
只处理比输出新的原图；加 --all 强制全部重做。需要 Pillow（python3 -m pip install pillow）。
"""
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "art-src" / "raw"
OUT = ROOT / "public" / "art"
# 类别 → 最长边像素上限
MAX_SIDE = {"characters": 720, "items": 256, "ui": 512, "locations": 640, "events": 960, "endings": 1280}


def process(src: Path, dst: Path, category: str) -> None:
    im = Image.open(src)
    if category == "backgrounds":
        im = im.convert("RGB")
        w, h = im.size
        target = 16 / 9
        if w / h > target:  # 太宽：裁左右
            nw = round(h * target)
            im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
        else:  # 太高：裁上下
            nh = round(w / target)
            im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
        im = im.resize((1920, 1080), Image.LANCZOS)
        dst.parent.mkdir(parents=True, exist_ok=True)
        im.save(dst, "WEBP", quality=84, method=6)
        return
    im = im.convert("RGBA")
    bbox = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    if bbox:
        im = im.crop(bbox)
    limit = MAX_SIDE.get(category, 512)
    scale = limit / max(im.size)
    if scale < 1:
        im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, "WEBP", quality=88, method=6)


def main() -> None:
    force = "--all" in sys.argv
    count = 0
    for src in sorted(RAW.glob("*/*/*.png")):
        category, art_id, state = src.parts[-3], src.parts[-2], src.stem
        dst = OUT / category / art_id / f"{state}.webp"
        if not force and dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
            continue
        process(src, dst, category)
        count += 1
        print(f"{src.relative_to(ROOT)} -> {dst.relative_to(ROOT)} ({dst.stat().st_size // 1024} KB)")
    print(f"处理了 {count} 张。")


if __name__ == "__main__":
    main()
