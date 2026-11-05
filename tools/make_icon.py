#!/usr/bin/env python3
# 生成 MC 启动器专属图标 build/icon.ico（多尺寸）
# 设计：蓝紫渐变圆角方块 + 白色启动(播放)三角，与界面主色一致
import os
from PIL import Image, ImageDraw, ImageFilter

SIZE = 512
OUT = os.path.join(os.path.dirname(__file__), '..', 'build', 'icon.ico')

def rounded_mask(size, radius):
    w, h = size
    mask = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)
    return mask

def diagonal_gradient(size, c1, c2):
    w, h = size
    img = Image.new('RGB', (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x / (w - 1) + y / (h - 1)) / 2.0
            r = int(c1[0] + (c2[0] - c1[0]) * t)
            g = int(c1[1] + (c2[1] - c1[1]) * t)
            b = int(c1[2] + (c2[2] - c1[2]) * t)
            px[x, y] = (r, g, b)
    return img

def make_master():
    base = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    # 渐变背景
    grad = diagonal_gradient((SIZE, SIZE), (79, 107, 237), (56, 189, 248))
    mask = rounded_mask((SIZE, SIZE), 110)
    base.paste(grad, (0, 0), mask)
    # 顶部高光
    d = ImageDraw.Draw(base)
    d.rounded_rectangle([18, 18, SIZE - 18, SIZE - 18], radius=100,
                        outline=(255, 255, 255, 60), width=6)
    # 启动三角（带阴影）
    cx, cy = SIZE // 2, SIZE // 2
    R = SIZE * 0.30
    tri = [(cx - R * 0.42, cy - R * 0.62),
           (cx - R * 0.42, cy + R * 0.62),
           (cx + R * 0.70, cy)]
    shadow = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.polygon([(x + 8, y + 12) for (x, y) in tri], fill=(0, 0, 0, 90))
    shadow = shadow.filter(ImageFilter.GaussianBlur(10))
    base = Image.alpha_composite(base, shadow)
    d = ImageDraw.Draw(base)
    d.polygon(tri, fill=(255, 255, 255, 255))
    return base

def main():
    master = make_master()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sizes = [(256, 256), (128, 128), (96, 96), (64, 64), (48, 48), (32, 32), (16, 16)]
    master.save(OUT, format='ICO', sizes=sizes)
    print('已生成图标:', os.path.abspath(OUT))
    print('包含尺寸:', ', '.join(f'{w}x{h}' for w, h in sizes))

if __name__ == '__main__':
    main()
