"""原创音效合成：只用 Python 标准库，从正弦波和噪声算出来，不含任何第三方采样。
运行：python3 tools/make_sfx.py  → 生成 public/sfx/*.wav（48kHz 单声道 16-bit）"""
import math, random, struct, wave, os

SR = 48000
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'sfx')
random.seed(7)

def save(name, samples, peak=0.7):
    m = max(abs(s) for s in samples) or 1
    data = b''.join(struct.pack('<h', int(max(-1, min(1, s / m * peak)) * 32767)) for s in samples)
    with wave.open(os.path.join(OUT, name + '.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data)
    print(f'{name}.wav  {len(samples)/SR:.2f}s')

def n(sec): return int(SR * sec)

def tone(freq, sec, decay, harm=0.0, f_end=None):
    out, ph = [], 0.0
    for i in range(n(sec)):
        t = i / SR
        f = freq if f_end is None else freq + (f_end - freq) * (t / sec)
        ph += 2 * math.pi * f / SR
        env = math.exp(-t * decay) * min(1, t / 0.003)
        out.append((math.sin(ph) + harm * math.sin(2 * ph)) * env)
    return out

def noise(sec, cut_start, cut_end, shape):
    out, y = [], 0.0
    for i in range(n(sec)):
        p = i / n(sec)
        cut = cut_start + (cut_end - cut_start) * p
        a = 1 - math.exp(-2 * math.pi * cut / SR)
        y += a * (random.uniform(-1, 1) - y)   # 一阶低通，截止频率随时间移动
        out.append(y * shape(p))
    return out

def mix(*tracks):
    L = max(len(t) for t in tracks)
    return [sum(t[i] for t in tracks if i < len(t)) for i in range(L)]

def delay(track, sec): return [0.0] * n(sec) + track

bell = lambda p: math.sin(math.pi * p) ** 2

# 点击：很短的高频「嗒」
save('click', mix(tone(2100, 0.035, 160, f_end=1500), [s * 0.25 for s in noise(0.012, 6000, 3000, lambda p: 1 - p)]), 0.55)
# 弹出：音高上滑的「啵」
save('pop', tone(420, 0.11, 38, harm=0.2, f_end=900), 0.6)
# 小弹出：卡片飞入用，更轻更短
save('pop-soft', tone(520, 0.07, 55, f_end=820), 0.4)
# 转场：一阵由闷到亮的风声
save('whoosh', noise(0.42, 300, 5200, bell), 0.5)
# 滑动：更短更轻的风声
save('swipe', noise(0.24, 900, 3600, bell), 0.35)
# 成功：两个上行的清亮音
save('success', mix(tone(1047, 0.32, 11, harm=0.15), delay(tone(1568, 0.42, 9, harm=0.15), 0.09)), 0.6)
# 提示：两个下行的低音，用于「无信号」
save('alert', mix(tone(392, 0.16, 16, harm=0.35), delay(tone(294, 0.26, 12, harm=0.35), 0.13)), 0.55)
# 结尾：一个展开的大三和弦
save('chime', mix(*[delay(tone(f, 1.4, 3.2, harm=0.12), i * 0.06) for i, f in enumerate([523.25, 659.25, 783.99, 1046.5])]), 0.6)
