# Break The World 구현 계획

> **For agentic workers:** 이 계획은 모바일 전용 캔버스 파괴 게임을 단계별로 구현한다.
> 시각/연출 모듈은 "빌드 통과 + 렌더 확인"으로 검증하고, 순수 로직(파편 기하·파티클·상태)은 단위 테스트한다.

**Goal:** 폰에서 손가락으로 "세상"을 21가지 방식으로 와장창 부수는 스트레스 해소 웹앱을, GitHub Actions로 GitHub Pages에 배포.

**Architecture:** Vite + TypeScript. 단일 캔버스에 RAF 게임루프. `engine`(루프·렌더·입력·카메라·파티클·오디오) + `effects`(공용 이펙트 프리미티브) + `targets`(부술 대상) + `weapons`(21종, 이펙트 조합 레시피) + `ui`. 아트는 SVG를 코드로 생성→오프스크린 비트맵 캐시.

**Tech Stack:** Vite, TypeScript, HTML5 Canvas 2D, roughjs, Web Audio API, Vitest(로직 테스트), GitHub Actions + Pages.

---

## 파일 구조 (책임 분리)

```
index.html                  모바일 viewport, 캔버스, 루트
src/
  main.ts                   부팅: 캔버스/엔진/게임 와이어링
  game.ts                   게임 상태머신: 입력→무기발동→타겟/콤보 관리
  engine/
    loop.ts                 RAF 루프(dt), 탭 숨김 정지
    renderer.ts             컨텍스트, DPR, 리사이즈, 레이어 클리어
    input.ts                터치(탭/쓸기/멀티터치)→PointerHit 이벤트
    camera.ts               shake/flash/zoom 펀치 (transform 적용)
    particles.ts            파티클 풀(먼지·불꽃·연기·재·파편)
    audio.ts                Web Audio 합성 SFX + 음소거
    rng.ts                  시드 가능한 난수(테스트 결정성)
    math.ts                 vec2, clamp, lerp, rand 헬퍼
  effects/
    types.ts                Effect 인터페이스(update/draw/done)
    manager.ts              EffectManager: 활성 이펙트 업데이트/렌더
    explosion.ts crack.ts fragmentBurst.ts shockwave.ts beam.ts projectile.ts dust.ts
  art/
    rough-cache.ts          rough.js로 그린 SVG/도형을 비트맵 스프라이트로 캐시
    palette.ts              두들 팔레트(외곽선/파스텔/스피드라인)
    earth-art.ts city-art.ts word-art.ts   타겟 아트(캔버스 드로잉)
    characters/             cinnamoroll.ts thanos.ts ironman.ts hulk.ts godzilla.ts
                            dragonball.ts cat.ts ditto.ts pooh.ts (캐릭터 드로잉)
  targets/
    target.ts               Target 인터페이스
    breakable.ts            공통: 비트맵→shatter 조각 관리, 데미지, 파괴판정
    shatter.ts              비트맵을 다각형 조각으로 분할(보로노이식)
    earth.ts city.ts word.ts
    manager.ts              타겟 순환/교체
  weapons/
    weapon.ts               Weapon 인터페이스 + WeaponContext
    registry.ts             21종 등록 + 메타(아이콘/이름)
    elemental/ (12 파일)
    characters/ (9 파일)
    bar.ts                  하단 무기 선택 바(터치)
  ui/
    hud.ts                  콤보 카운터, 사운드 토글, 리셋/다음
  style.css
.github/workflows/deploy.yml
vite.config.ts  tsconfig.json  package.json
```

---

## Phase 0 — 스캐폴드

### Task 1: 프로젝트 초기화
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/style.css`, `src/main.ts`
- [ ] Vite+TS 구성, deps: `roughjs`; dev deps: `typescript`, `vite`, `vitest`
- [ ] `index.html`: `<meta viewport ... user-scalable=no>`, 전체화면 캔버스, 터치 스크롤 방지 CSS
- [ ] `vite.config.ts`: `base: '/breaktheworld/'`, vitest 설정
- [ ] `src/main.ts`: "Hello" 캔버스 채우기
- [ ] 검증: `npm install` → `npm run dev` 캔버스 표시 / `npm run build` 통과

---

## Phase 1 — 엔진 코어 (로직은 TDD)

### Task 2: math + rng (TDD)
- Create: `src/engine/math.ts`, `src/engine/rng.ts`, tests
- [ ] 테스트 작성: `clamp`, `lerp`, `vec2` 연산; `mulberry32` 시드 동일→동일 수열
- [ ] 실패 확인 → 구현 → 통과 → 커밋

### Task 3: 게임 루프 (TDD)
- Create: `src/engine/loop.ts`, test
- [ ] 테스트: 가짜 시간으로 `tick` 호출 시 dt 누적/콜백 호출
- [ ] 구현(RAF 래핑, `document.hidden` 정지), 통과, 커밋

### Task 4: 렌더러
- Create: `src/engine/renderer.ts`
- [ ] DPR 스케일, 리사이즈 옵저버, `clear()`, 좌표 헬퍼. 검증: dev에서 리사이즈 시 선명/꽉참

### Task 5: 입력 (TDD)
- Create: `src/engine/input.ts`, test
- [ ] 테스트: touchstart→`down`, touchmove→`drag`(연속 hit), 멀티터치→복수 hit, 좌표 변환
- [ ] 구현(passive:false, preventDefault), 통과, 커밋

### Task 6: 카메라(shake/flash)
- Create: `src/engine/camera.ts`
- [ ] `shake(intensity)`, `flash(color,a)`, `punch(scale)` → 매 프레임 감쇠. `applyPre/Post(ctx)`. 검증: 임시 버튼으로 흔들림 확인

### Task 7: 파티클 풀 (TDD)
- Create: `src/engine/particles.ts`, test
- [ ] 테스트: spawn N → active N, 수명 경과 후 재활용(풀 크기 고정), 중력/속도 적분
- [ ] 구현(타입: dust/spark/smoke/ash/shard, 렌더), 통과, 커밋

### Task 8: 오디오
- Create: `src/engine/audio.ts`
- [ ] 합성 SFX: `boom`, `glass`, `thud`, `snap`, `zap`, `whoosh`, `freeze`. 음소거 토글, 첫 제스처 unlock. 검증: 탭 시 소리

---

## Phase 2 — 타겟 & 파편

### Task 9: shatter 기하 (TDD)
- Create: `src/targets/shatter.ts`, test
- [ ] 테스트: 마스크 영역 내 시드점 N개 → 셀 N개, 각 셀 정점≥3, 조각 합 면적≈원본
- [ ] 구현: 경계 내 포아송/지터 그리드 점 → 가까운 점 기준 삼각/다각 분할(간단 보로노이 근사). 통과, 커밋

### Task 10: breakable 비트맵 조각
- Create: `src/targets/target.ts`, `src/targets/breakable.ts`
- [ ] 아트 비트맵 + shatter 폴리곤 → 조각(clip+draw 한 번 렌더해 스프라이트화), 조각 물리(속도/회전/중력/페이드), `takeDamage(point,radius,force)`로 해당 영역 조각 분리, `isDestroyed`

### Task 11: 타겟 아트 + 인스턴스
- Create: `src/art/palette.ts`, `src/art/rough-cache.ts`, `src/art/earth-art.ts`/`city-art.ts`/`word-art.ts`, `src/targets/earth.ts`/`city.ts`/`word.ts`
- [ ] 두들 스타일(까만 외곽선·파스텔·rough). 지구(대륙 덩어리), 도시(빌딩 실루엣), "세상" 큰 글자. 검증: 각 타겟 렌더 확인

### Task 12: 타겟 매니저 (TDD)
- Create: `src/targets/manager.ts`, test
- [ ] 테스트: 파괴 시 다음 타겟 인덱스 순환, 교체 딜레이 후 새 타겟. 통과, 커밋

---

## Phase 3 — 공용 이펙트 툴킷

### Task 13: 이펙트 매니저 + 프리미티브
- Create: `src/effects/types.ts`, `manager.ts`, `explosion.ts`, `crack.ts`, `fragmentBurst.ts`, `shockwave.ts`, `beam.ts`, `projectile.ts`, `dust.ts`
- [ ] 각 이펙트: `update(dt)`, `draw(ctx)`, `done`. 파티클/카메라/오디오 훅 사용.
  - explosion: 화염구 확장 + 섬광 + 연기 + spark 버스트
  - crack: 분기하는 균열 라인 전파
  - fragmentBurst: 파편 사방으로
  - shockwave: 확장 링(알파 감쇠)
  - beam: 시작→끝 빔 + 글로우 + 코어
  - projectile: 시작점→목표 낙하 + 트레일 → 콜백(임팩트)
  - dust: 먼지구름 상승/확산
- [ ] 검증: 임시 트리거로 각 이펙트 눈으로 확인

---

## Phase 4 — 무기 21종

### Task 14: 무기 인터페이스 + 레지스트리 + 바
- Create: `src/weapons/weapon.ts`, `registry.ts`, `bar.ts`
- [ ] `Weapon { id,name,icon, mode:'point'|'drag'|'cinematic', apply(ctx, hit) }`
  `WeaponContext { target, effects, particles, camera, audio, rng, viewport }`
- [ ] 하단 무기 바(가로 스크롤, 큰 터치 타깃, 선택 표시)

### Task 15: 원소·물리 12종
- Create: `src/weapons/elemental/*.ts` (hammer, fist, glass, laser, meteor, missile, bomb, lightning, flame, tornado, freeze, blackhole)
- [ ] 각 무기 = 이펙트 조합 레시피 + 타겟 데미지 + 카메라/오디오. (레시피 표는 스펙 6장)
- [ ] 검증: 각 무기로 타겟 부수기 확인

### Task 16: 캐릭터 9종 (아트 + 연출)
- Create: `src/art/characters/*.ts` + `src/weapons/characters/*.ts`
  (cinnamoroll, thanos, ironman, hulk, godzilla, dragonball, cat, ditto, pooh)
- [ ] 각 캐릭터 SVG/캔버스 두들 아트 + 시네마틱(등장→액션→임팩트) + 타겟 파괴
  - cinnamoroll: 위에서 낙하 → 납작 압살 + 스피드라인
  - thanos: 건틀릿 스냅 → 조각 절반 먼지로 디졸브
  - ironman: 등장 → 리펄서 빔 → 폭발
  - hulk: 두 주먹 내리침 → 지각 균열 붕괴
  - godzilla: 발 스톰프 + 입 광선 브레스
  - dragonball: 차지 → 대형 에너지파 관통
  - cat: 통통 고양이 엉덩이 압살(코믹)
  - ditto: 흐물흐물 늘어나 거대 주먹/망치 변신 강타
  - pooh: 꿀단지 → 끈적 폭발 + 엉덩이 압살
- [ ] 검증: 각 캐릭터 연출 확인

---

## Phase 5 — UI & 통합

### Task 17: HUD + 게임 와이어링
- Create: `src/ui/hud.ts`, `src/game.ts`; Modify: `src/main.ts`
- [ ] 콤보 카운터(타격+1, 무입력 리셋), 사운드 토글, 리셋/다음 버튼
- [ ] game.ts: 입력→선택무기.apply→타겟파괴 시 매니저 교체. main.ts 전체 연결
- [ ] 검증: dev 모바일 뷰에서 전체 플레이 루프 동작

---

## Phase 6 — 배포

### Task 18: GitHub Actions → Pages
- Create: `.github/workflows/deploy.yml`, `README.md`, `.gitignore`
- [ ] `git init`, 워크플로(Node→`npm ci`→`npm run build`→deploy-pages)
- [ ] 검증: `npm run build` 통과. (실제 배포는 사용자 GitHub 저장소 연결 후)

---

## Self-Review (계획↔스펙)
- 스펙 21무기/3타겟/9캐릭터/모바일/사운드/배포 → 모두 Task로 커버 ✓
- 시각 모듈은 단위테스트 대신 렌더 검증(명시) ✓
- 타입 일관: `Weapon.apply(ctx,hit)`, `Target.takeDamage(point,radius,force)`, `EffectManager` 통일 ✓
