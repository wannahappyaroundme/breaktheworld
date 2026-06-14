# 🎨 이미지 에셋 가이드 (AI 생성용 프롬프트 팩)

여기 있는 프롬프트를 **하나씩** AI 이미지 생성기(ChatGPT/DALL·E, Midjourney, 등)에 넣어 만드세요.
다 만들면 아래 **정확한 파일명**으로 `public/assets/` 폴더에 넣으면 **게임에 자동 적용**됩니다.
(이미지를 안 넣으면 제가 만든 임시 두들 아트로 자동 폴백됩니다.)

## ✅ 공통 규칙 (모든 이미지)
- **배경 완전 투명** (PNG, 알파 채널). 프롬프트에 배경제거 요청이 들어가 있어요.
- **정사각형 1024×1024**, 피사체를 **중앙**에, 가장자리에 **10~15% 여백**.
- 스타일 통일: **귀여운 카와이 두들 / 플래시게임 스티커**, **두꺼운 검은 외곽선**, **납작한 파스텔 + 부드러운 셰이딩**, 글자·워터마크·그림자 없음.
- 만약 생성기가 투명배경을 지원 안 하면 → **단색(흰색) 배경**으로 만든 뒤 [remove.bg](https://remove.bg) 같은 도구로 배경 제거.

## 📁 파일명 매핑 (이대로 저장)
| 파일명 (`public/assets/`) | 용도 |
|---|---|
| `earth.png` | 타겟 1 — 지구 (부서짐) |
| `city.png` | 타겟 2 — 도시 (부서짐) |
| `word.png` | 타겟 3 — "세상" 글자 (부서짐) |
| `cinnamoroll.png` | 캐릭터 — 시나모롤 |
| `thanos.png` | 캐릭터 — 타노스 |
| `ironman.png` | 캐릭터 — 아이언맨 |
| `hulk.png` | 캐릭터 — 헐크 |
| `godzilla.png` | 캐릭터 — 고질라 |
| `dragonball.png` | 캐릭터 — 드래곤볼 전사 |
| `cat.png` | 캐릭터 — 귀여운 고양이 |
| `ditto.png` | 캐릭터 — 메타몽 |
| `pooh.png` | 캐릭터 — 곰돌이 푸 |
| `og-image.png` | 공유 썸네일 (1200×630, **배경 있음**) |

> 💡 타겟(`earth/city/word`)은 통이미지여도 게임이 알아서 **산산조각** 냅니다. 캐릭터는 **정면 전신**이 제일 잘 어울려요.

---

# 1) earth.png — 지구
```
A cute cartoon planet Earth, perfectly round globe, glossy blue oceans and friendly green continents, soft cel shading and a subtle white highlight, thick black outline, flat pastel colors, kawaii doodle / flash-game sticker style, centered, full planet visible with padding, NO background — fully transparent background, isolated subject, PNG with alpha, high resolution, square, no text, no watermark, no drop shadow
```

# 2) city.png — 도시
```
A cute cartoon city skyline, a cluster of colorful little skyscrapers with glowing windows, side view standing on a tiny ground strip, thick black outline, flat pastel colors, kawaii doodle / flash-game sticker style, centered with padding, NO background — fully transparent (sky must be transparent), isolated buildings, PNG with alpha, high resolution, square, no text, no watermark, no drop shadow
```

# 3) word.png — "세상" 글자
```
The Korean word "세상" as big bubbly glossy 3D balloon letters, bold rounded chunky lettering, bright warm gradient (yellow to orange), thick black outline, cute flash-game logo style, centered with padding, NO background — fully transparent background, isolated, PNG with alpha, high resolution, square, no watermark, no drop shadow
```
> ⚠️ AI가 한글 "세상"을 자주 틀리게 그려요. 결과가 이상하면 이 파일은 **건너뛰면** 제 내장 글자 아트가 자동으로 쓰입니다. (또는 직접 캔바/포토샵에서 "세상" 글자를 만들어 넣어도 OK)

# 4) cinnamoroll.png — 시나모롤
```
A cute white fluffy puppy character with very long floppy ears, big round head, plump little body, big sparkly blue eyes, rosy pink cheeks, tiny happy smile, a small curly tail, diving downward with paws forward like it is flying, thick black outline, flat soft pastel colors, kawaii doodle / flash-game sticker style, centered full body with padding, NO background — fully transparent background, isolated subject, PNG with alpha, high resolution, square, no text, no watermark, no drop shadow
```

# 5) thanos.png — 타노스
```
A cartoon purple muscular titan villain, big strong chin, stern face, wearing a golden gauntlet glove with six glowing colorful gems on his hand, doing a finger-snap pose, friendly chunky proportions, thick black outline, flat shaded colors, kawaii doodle / flash-game sticker style, centered full body with padding, NO background — fully transparent background, isolated subject, PNG with alpha, high resolution, square, no text, no watermark, no drop shadow
```

# 6) ironman.png — 아이언맨
```
A cartoon red-and-gold armored superhero, sleek helmet with glowing white eyes, a bright blue glowing arc reactor on the chest, one hand extended forward firing a glowing repulsor beam, flying pose, thick black outline, flat shaded metallic colors, kawaii doodle / flash-game sticker style, centered full body with padding, NO background — fully transparent background, isolated subject, PNG with alpha, high resolution, square, no text, no watermark, no drop shadow
```

# 7) hulk.png — 헐크
```
A cartoon huge green muscular giant, angry expression with furrowed brows, enormous fists raised up ready to smash down, chunky friendly proportions, ripped purple shorts, thick black outline, flat shaded green colors, kawaii doodle / flash-game sticker style, centered full body with padding, NO background — fully transparent background, isolated subject, PNG with alpha, high resolution, square, no text, no watermark, no drop shadow
```

# 8) godzilla.png — 고질라
```
A cute cartoon kaiju monster, gray-green dinosaur with rows of jagged dorsal spine plates on its back, roaring with mouth open, sturdy legs and tail, friendly chunky proportions, thick black outline, flat shaded colors, kawaii doodle / flash-game sticker style, centered full body with padding, NO background — fully transparent background, isolated subject, PNG with alpha, high resolution, square, no text, no watermark, no drop shadow
```

# 9) dragonball.png — 드래곤볼 전사
```
A cartoon anime warrior with spiky golden hair and a determined face, cupping both hands at his side charging a glowing blue energy ball (kamehameha pose), orange martial-arts gi, thick black outline, flat shaded colors, kawaii doodle / flash-game sticker style, centered full body with padding, NO background — fully transparent background, isolated subject, PNG with alpha, high resolution, square, no text, no watermark, no drop shadow
```

# 10) cat.png — 귀여운 고양이
```
A chubby adorable gray kitten, big round body, pointy ears, big cute eyes, rosy cheeks, tiny whiskers, sitting plump pose, thick black outline, flat soft pastel colors, kawaii doodle / flash-game sticker style, centered full body with padding, NO background — fully transparent background, isolated subject, PNG with alpha, high resolution, square, no text, no watermark, no drop shadow
```

# 11) ditto.png — 메타몽
```
A cute pink-purple amorphous blob creature, simple smooth gooey body, tiny black dot eyes and a small wavy smiling mouth, derpy adorable expression, thick black outline, flat pastel purple-pink color with soft shading, kawaii doodle / flash-game sticker style, centered with padding, NO background — fully transparent background, isolated subject, PNG with alpha, high resolution, square, no text, no watermark, no drop shadow
```

# 12) pooh.png — 곰돌이 푸
```
A cute chubby golden-yellow cartoon bear wearing a small red crop t-shirt, round friendly face, holding a honey pot, happy expression, thick black outline, flat warm pastel colors, kawaii doodle / flash-game sticker style, centered full body with padding, NO background — fully transparent background, isolated subject, PNG with alpha, high resolution, square, no text, no watermark, no drop shadow
```

---

# 13) og-image.png — 공유 썸네일 (배경 있음, 1200×630)
> 이건 **투명배경이 아니라** 가로 배너예요. 1200×630으로 만들고 `public/assets/`가 아니라 `public/` 에 `og-image.png`로 저장하세요 (기존 임시본을 덮어쓰기).
```
A dynamic landscape banner (1200x630) for a stress-relief game called "Break The World". A cute white fluffy puppy character dives down and smashes a cartoon planet Earth that is shattering into pieces, dramatic yellow speed lines, debris flying, dark starry space background with a soft purple nebula glow, thick black outlines, flat pastel colors, kawaii flash-game poster style, bold playful title text "세상 부수기" with a thick outline, exciting and satisfying mood, high quality, no watermark
```

---

## 넣은 뒤
1. 파일을 `public/assets/`(og는 `public/`)에 정확한 이름으로 저장
2. `npm run dev` 로 확인 (이미지 넣은 캐릭터/타겟이 자동 반영)
3. 좋으면 커밋 → 배포

다 만들어서 폴더에 넣어주시면, 제가 크기/위치/밸런스 한 번 더 맞춰드릴게요!
