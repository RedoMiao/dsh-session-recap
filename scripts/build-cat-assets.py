"""四张 GIF → 统一画布/统一体型/统一地面线的动画 WebP（定稿版）。

三步抠图：
 1) 背景：b-r>=4 且 r>=232，从四边 BFS 只删连通区域
 2) 地面带：逐行从左右边缘向内删"亮中性"像素，遇不满足即停
 3) 阴影：从已透明区扩散，判据 10<=b-r<=45 且 |g-r|<=12 且 160<=r<=232
定尺寸：逐帧取最大不透明连通体的 bbox，四帧取并集，用它决定缩放与留白。
画布 216x240，地面线 y=210，水平中心 x=108，四边留白 >=16。
"""
import json
import os
from collections import deque

from PIL import Image, ImageDraw, ImageSequence

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.environ.get("CAT_SRC_DIR", os.path.join(ROOT, "assets-src"))
OUT = os.path.join(ROOT, "assets")
ANCHORS = os.path.join(OUT, "cat-anchors.json")
SOURCES = [
    ("小猫清醒时.gif", "cat-idle", 150),
    ("单击小猫时.gif", "cat-click", 150),
    ("长按鼠标，移动小猫时.gif", "cat-drag", 150),
    ("长时间待机，小猫睡觉.gif", "cat-sleep", 150),
]

CANVAS_W = 216
CANVAS_H = 240
BASELINE = 210
CENTER_X = 108
MARGIN = 16


def is_bg(p):
    r, g, b, a = p
    return a > 0 and (b - r) >= 4 and r >= 232


def is_neutral(p):
    r, g, b, a = p
    return a > 0 and r >= 238 and (max(r, g, b) - min(r, g, b)) <= 8


def is_shadow(p):
    r, g, b, a = p
    return a > 0 and 10 <= (b - r) <= 45 and abs(g - r) <= 12 and 160 <= r <= 232


def key_frame(frame):
    im = frame.convert("RGBA")
    w, h = im.size
    px = im.load()

    # 1) 背景
    seen = bytearray(w * h)
    q = deque()

    def push(x, y):
        if not seen[y * w + x] and is_bg(px[x, y]):
            seen[y * w + x] = 1
            q.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)
    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h:
                push(nx, ny)

    # 2) 地面带：从透明区 BFS 删亮中性像素（能钻到猫腿之间的缝里）
    q2 = deque()
    for y in range(h):
        for x in range(w):
            if px[x, y][3] == 0:
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and is_neutral(px[nx, ny]):
                        q2.append((nx, ny))
    while q2:
        x, y = q2.popleft()
        if px[x, y][3] == 0:
            continue
        px[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and is_neutral(px[nx, ny]):
                q2.append((nx, ny))

    # 3) 阴影：从透明区扩散
    q3 = deque()
    for y in range(h):
        for x in range(w):
            if px[x, y][3] == 0:
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and is_shadow(px[nx, ny]):
                        q3.append((nx, ny))
    while q3:
        x, y = q3.popleft()
        if px[x, y][3] == 0:
            continue
        px[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and is_shadow(px[nx, ny]):
                q3.append((nx, ny))

    # 4) 外侧一圈羽化
    ring = []
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0 or not (0 < (b - r) < 8):
                continue
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] == 0:
                    ring.append((x, y, b - r))
                    break
    for x, y, delta in ring:
        r, g, b, a = px[x, y]
        px[x, y] = (r, g, b, int(a * delta / 8))

    return im


def all_components(im, min_area=30):
    """所有面积 >= min_area 的连通体：[(面积, bbox)]。独立的心形/Z/动作线都算。"""
    w, h = im.size
    a = im.getchannel("A").load()
    seen = bytearray(w * h)
    out = []
    for y in range(h):
        for x in range(w):
            if a[x, y] == 0 or seen[y * w + x]:
                continue
            q = deque([(x, y)])
            seen[y * w + x] = 1
            n = 0
            minx = maxx = x
            miny = maxy = y
            while q:
                cx, cy = q.popleft()
                n += 1
                minx, maxx = min(minx, cx), max(maxx, cx)
                miny, maxy = min(miny, cy), max(maxy, cy)
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and a[nx, ny] > 0:
                        seen[ny * w + nx] = 1
                        q.append((nx, ny))
            if n >= min_area:
                out.append((n, (minx, miny, maxx + 1, maxy + 1)))
    out.sort(key=lambda t: t[0], reverse=True)
    return out


def largest_box(im):
    comps = all_components(im)
    return comps[0][1] if comps else (0, 0, im.width, im.height)


def hole_ratio(im):
    a = im.getchannel("A").load()
    x0, y0, x1, y1 = largest_box(im)
    seen = set()
    q = deque()
    for x in range(x0, x1):
        for y in (y0, y1 - 1):
            if a[x, y] == 0:
                seen.add((x, y))
                q.append((x, y))
    for y in range(y0, y1):
        for x in (x0, x1 - 1):
            if a[x, y] == 0 and (x, y) not in seen:
                seen.add((x, y))
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if x0 <= nx < x1 and y0 <= ny < y1 and a[nx, ny] == 0 and (nx, ny) not in seen:
                seen.add((nx, ny))
                q.append((nx, ny))
    inside = (x1 - x0) * (y1 - y0)
    cat = sum(1 for y in range(y0, y1) for x in range(x0, x1) if a[x, y] > 0)
    return max(0, inside - len(seen) - cat) / max(1, cat)


def build(quality=78):
    os.makedirs(OUT, exist_ok=True)
    anchors = {}
    rows = []
    keys = []

    for src_name, key, target_w in SOURCES:
        im = Image.open(os.path.join(SRC, src_name))
        frames = [key_frame(f) for f in ImageSequence.Iterator(im)]
        durations = []
        im.seek(0)
        try:
            while True:
                durations.append(im.info.get("duration", 100))
                im.seek(im.tell() + 1)
        except EOFError:
            pass

        # 内容框 = 所有面积>=30 的连通体、跨所有帧的并集（心形/Z/动作线都保留）
        content = []
        cat_boxes = []
        for f in frames:
            comps = all_components(f, 30)
            if not comps:
                continue
            cat_boxes.append(comps[0][1])
            for _, b in comps:
                content.append(b)
        ux0 = min(b[0] for b in content)
        uy0 = min(b[1] for b in content)
        ux1 = max(b[2] for b in content)
        uy1 = max(b[3] for b in content)
        uw, uh = ux1 - ux0, uy1 - uy0

        # 缩放按猫体（最大组件）宽度归一化；垂直/水平锚点也用猫体，不用内容框
        cat_w = max(b[2] - b[0] for b in cat_boxes)
        cat_cx = sum((b[0] + b[2]) / 2 for b in cat_boxes) / len(cat_boxes)
        cat_bottom = max(b[3] for b in cat_boxes)

        scale = min(
            target_w / cat_w,
            (CANVAS_W - 2 * MARGIN) / uw,
            (BASELINE - MARGIN) / (cat_bottom - uy0),
            1.0,
        )
        dx = round(CENTER_X - (cat_cx - ux0) * scale)
        dy = round(BASELINE - (cat_bottom - uy0) * scale)
        # 边缘兜底：宁可轻微偏心，也不让内容出画布
        dx = max(MARGIN, min(CANVAS_W - MARGIN - round(uw * scale), dx))
        dy = max(MARGIN, min(CANVAS_H - MARGIN - round(uh * scale), dy))

        rendered = []
        for f in frames:
            nw, nh = max(1, round(uw * scale)), max(1, round(uh * scale))
            k = f.crop((ux0, uy0, ux1, uy1)).resize((nw, nh), Image.LANCZOS)
            c = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
            c.paste(k, (dx, dy), k)
            rendered.append(c)

        dst = os.path.join(OUT, key + ".webp")
        rendered[0].save(
            dst, save_all=True, append_images=rendered[1:], format="WEBP",
            quality=quality, method=6, duration=(durations[0] if durations else 100), loop=0,
        )
        if key == "cat-idle":
            rendered[0].save(os.path.join(OUT, "cat-idle.png"))

        bb = rendered[0].getchannel("A").getbbox()
        rows.append({
            "key": key, "kb": os.path.getsize(dst) / 1024,
            "uw": round(uw * scale), "uh": round(uh * scale),
            "top": bb[1], "left": bb[0], "right": CANVAS_W - bb[2],
            "bottom": CANVAS_H - bb[3], "hole": hole_ratio(rendered[0]),
        })
        anchors[key] = {"scale": round(scale, 4), "dx": dx, "dy": dy, "unionW": uw}
        keys.append(key)

    with open(ANCHORS, "w", encoding="utf-8") as fh:
        json.dump(anchors, fh, ensure_ascii=False, indent=2)

    for bg, name, cell_scale in (
        ((245, 245, 247, 255), "cat-states.png", 1),
        ((43, 43, 51, 255), "cat-states-dark.png", 1),
        ((245, 245, 247, 255), "cat-preview-72.png", 72 / CANVAS_W),
    ):
        cw, ch = round(CANVAS_W * cell_scale), round(CANVAS_H * cell_scale)
        gap = 6 if cell_scale != 1 else 0
        img = Image.new("RGBA", (cw * len(keys) + gap * (len(keys) - 1), ch), bg)
        draw = ImageDraw.Draw(img)
        for i, key in enumerate(keys):
            f = Image.open(os.path.join(OUT, key + ".webp")).convert("RGBA")
            if cell_scale != 1:
                f = f.resize((cw, ch), Image.LANCZOS)
            img.alpha_composite(f, (i * (cw + gap), 0))
            if cell_scale == 1:
                draw.text((i * cw + 6, 6), key.replace("cat-", ""), fill=(120, 120, 120, 255))
        if cell_scale == 1:
            draw.line([(0, BASELINE), (img.width, BASELINE)], fill=(220, 30, 30, 255), width=1)
        img.convert("RGB").save(os.path.join(OUT, name))

    return rows


if __name__ == "__main__":
    total = 0
    for r in build(78):
        total += r["kb"]
        print(f'{r["key"]:<10} {r["kb"]:6.1f}KB  union={r["uw"]}x{r["uh"]}  top={r["top"]}  L={r["left"]} R={r["right"]}  bottom={r["bottom"]}  hole={r["hole"]*100:.2f}%')
    print(f"total {total:.1f}KB")
