# 💥 세상 부수기 (Break The World)

폰에서 손가락으로 **세상을 와장창 부수며 스트레스를 푸는** 모바일 전용 웹게임.
21가지 파괴 방식(망치·운석·폭발 ~ 타노스·시나모롤·곰돌이푸)으로 지구·도시·"세상"을 통쾌하게!

플래시게임 두들 감성 · 손맛 나는 파편·폭발·화면진동 · Web Audio 효과음.

## 🎮 기능
- **타겟 3종 자동 순환**: 지구 → 도시 → "세상" 글자 (부서지면 다음으로)
- **파괴기 21종**
  - 물리·원소 12: 🔨망치 👊주먹 🧊유리 🔪레이저 ☄️운석 🚀미사일 💣대폭발 ⚡번개 🔥화염 🌪️토네이도 ❄️빙결 🕳️블랙홀
  - 캐릭터 9: ☁️시나모롤 🫰타노스 🦾아이언맨 🟢헐크 🦖고질라 🐉드래곤볼 🐱고양이 🟣메타몽 🍯곰돌이푸
- 탭/쓸기/멀티터치, 콤보 카운터, 🔇 사운드 토글, 다음/리셋, PWA(홈 화면 추가)

## 🛠 개발
```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 타입체크 + 프로덕션 빌드 (dist/)
npm test           # 로직 단위 테스트
```
- 데모 자동시연: `?demo` 또는 `?demo=thanos` (무기 지정)
- 아트 프리뷰: `/preview.html`

## 🎨 이미지(아트) 넣기 — 자동 적용
캐릭터/타겟을 직접 만든 이미지로 바꾸려면 **[ASSETS.md](./ASSETS.md)** 의 프롬프트로 만들어
`public/assets/`에 정해진 파일명(투명 PNG)으로 넣기만 하면 **자동 교체**됩니다.
(이미지가 없으면 내장 두들 아트로 폴백)

## 🚀 배포 (GitHub Pages)
1. 이 저장소를 GitHub에 푸시 (저장소 이름: `breaktheworld` 권장)
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**
3. `main` 에 push 하면 [.github/workflows/deploy.yml](.github/workflows/deploy.yml) 가 자동 빌드·배포
4. 결과 URL: `https://<your-id>.github.io/breaktheworld/`

### ⚠️ 배포 전 2곳 확인
- 저장소 이름이 `breaktheworld`가 아니면 [vite.config.ts](./vite.config.ts) 의 `base`를 `/<저장소이름>/` 로 변경
- [index.html](./index.html) 의 OG 메타 `your-id` 를 본인 GitHub 아이디로 변경 (공유 썸네일용 절대 URL)

## 🧩 기술 스택
Vite · TypeScript · HTML5 Canvas 2D · rough.js(손그림 렌더) · Web Audio API · Vitest · GitHub Actions

## 📐 구조
- `src/engine/` 루프·렌더·입력·카메라·파티클·오디오
- `src/effects/` 폭발·균열·충격파·빔·발사체·번개·블랙홀·토네이도(공용 이펙트 툴킷)
- `src/targets/` 부서지는 타겟 + shatter 기하 + 순환 매니저
- `src/weapons/` 21종 무기(이펙트 조합 레시피) + 무기 바
- `src/art/` 두들 아트 + 드롭인 이미지 로더
- `src/ui/` HUD(콤보·사운드·리셋/다음)
