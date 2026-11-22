"""Makes the tiny GIF fixtures the GIF decoder tests read."""
from pathlib import Path
from PIL import Image
here = Path(__file__).parent

def solid(c, size=(8, 6)):
    return Image.new('RGB', size, c).convert('P', palette=Image.ADAPTIVE)

fr = [solid(c) for c in [(255, 0, 0), (0, 255, 0), (0, 0, 255)]]
fr[0].save(here / 'solid3.gif', save_all=True, append_images=fr[1:], duration=100, loop=0, optimize=False, disposal=1)

fr = [solid(c) for c in [(255, 0, 0), (0, 255, 0), (0, 0, 255)]]
fr[0].save(here / 'mixed.gif', save_all=True, append_images=fr[1:], duration=[40, 120, 0], loop=0, optimize=False, disposal=1)

# dispose.gif is written by hand (PIL writes a broken file for this case).
# Frame 1: blue. Frame 2: a 2x2 red patch at the top left on transparent, disposed to background.
# Frame 3: fully transparent, so it shows what's left: blue, with a cleared hole where the patch was.
import struct

def lzw_simple(pixels, min_code=2):
    """Valid but uncompressed LZW: a clear code every two pixels keeps the code size fixed at 3 bits."""
    clear, eoi, size = 1 << min_code, (1 << min_code) + 1, min_code + 1
    codes = []
    for i in range(0, len(pixels), 2):
        codes += [clear] + pixels[i:i + 2]
    codes.append(eoi)
    acc = bits = 0; out = bytearray()
    for c in codes:
        acc |= c << bits; bits += size
        while bits >= 8: out.append(acc & 255); acc >>= 8; bits -= 8
    if bits: out.append(acc & 255)
    blocks = bytearray([min_code])
    for i in range(0, len(out), 255): chunk = out[i:i + 255]; blocks += bytes([len(chunk)]) + chunk
    return bytes(blocks + b'\x00')

def frame(pixels, disposal, trans=2, delay=10, rect=(0, 0, 8, 6)):
    gce = b'\x21\xf9\x04' + bytes([(disposal << 2) | 1]) + struct.pack('<H', delay) + bytes([trans]) + b'\x00'
    return gce + b'\x2c' + struct.pack('<HHHH', *rect) + b'\x00' + lzw_simple(pixels)

blue = [0] * 48
patch = [1, 1, 1, 1]  # a 2x2 frame at the top left
clear_all = [2] * 48
gif = (b'GIF89a' + struct.pack('<HH', 8, 6) + bytes([0x81, 0, 0])
       + bytes([0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0])
       + frame(blue, 1) + frame(patch, 2, rect=(0, 0, 2, 2)) + frame(clear_all, 1) + b'\x3b')
(here / 'dispose.gif').write_bytes(gif)
print('made', sorted(p.name for p in here.glob('*.gif')))

# A larger, noisy picture so LZW codes grow past 9 bits; ref.bin holds PIL's RGBA for frame 0 to compare.
import random
random.seed(7)
big = Image.new('RGB', (64, 48))
big.putdata([(x * 4, y * 5, random.randrange(256)) for y in range(48) for x in range(64)])
big = big.convert('P', palette=Image.ADAPTIVE, colors=200)
big.save(here / 'big.gif', interlace=False)
(here / 'big_ref.bin').write_bytes(Image.open(here / 'big.gif').convert('RGBA').tobytes())
big.save(here / 'big_interlaced.gif', interlace=True)
