# 💥 세상 부수기 (Break The World)

폰에서 손가락으로 세상을 와장창 부수며 스트레스를 푸는 모바일 웹게임입니다. 처음에 게스트 또는 프로필을 고를 수 있고, 프로필을 만들면 여러 기기에서 기록을 이어갈 수 있습니다.

## 운영 주소

- 게임: [세상 부수기](https://wannahappyaroundme.github.io/breaktheworld/)
- 운영자 화면: [운영자 설정](https://wannahappyaroundme.github.io/breaktheworld/admin.html)

## 게임 이용 방법

1. 처음 접속하면 `새 프로필 만들기`, `내 프로필로 로그인`, `게스트로 시작` 중 하나를 고릅니다.
2. 게스트를 고른 기기에서는 다음 접속부터 선택 화면 없이 바로 게임을 시작합니다.
3. `📖 기록책`에서 오늘의 도전, 부순 기록, 캐릭터 모습과 설정을 확인합니다.
4. 새 프로필을 만들 때 프로필 ID 중복을 확인하고 숫자 6자리 PIN을 두 번 입력합니다.
5. 다른 기기에서는 같은 프로필 ID와 PIN으로 로그인합니다.
6. 프로필에서 로그아웃하면 게스트, 새 프로필, 기존 프로필 중 다음 이용 방법을 다시 고릅니다.

프로필 ID는 한글, 영문, 숫자로 2자에서 12자까지 사용할 수 있으며 중복될 수 없습니다. 새 프로필은 기록 0부터 시작합니다. 게스트 기록은 현재 기기에 그대로 남고 새 프로필로 옮겨지지 않습니다.

## 주요 기능

- 세상 글자, 지구, 도시가 차례로 등장하는 타겟 3종
- 망치부터 시나모롤, 타노스, 메타몽까지 파괴 방식 21종
- 짧게 탭, 쓸기, 길게 누른 뒤 놓는 강타, 여러 손가락 입력
- 캐릭터별 세 가지 움직임과 시나모롤·메타몽 클래식 모습
- 연속 기록, FEVER, 황금 타겟, 소리, 진동, 기록 카드 공유
- 하루 한 번 도전, 영구 도장 5종, 기록책과 알림
- 첫 접속 게스트·프로필 선택, 같은 기기의 게스트 선택 기억, 여러 기기 기록 동기화, 로그아웃
- 홈 화면에 추가할 수 있는 PWA

## 운영자 화면

승인된 운영자 이메일과 비밀번호로 로그인합니다. 운영자 화면에서 다음 항목을 관리할 수 있습니다.

- 오늘의 도전 추가·수정·기간 설정
- 게임 기능 켜기·끄기
- 날짜별 이용 통계와 캐릭터·강타 사용 현황
- 운영자 계정 추가·활성화·비활성화
- 플레이어 프로필 확인, 로그인 잠시 멈추기, 숫자 6자리 임시 PIN 재설정, 삭제

임시 PIN을 재설정하면 해당 프로필은 모든 기기에서 다시 로그인해야 합니다. PIN이나 비밀번호는 저장소 문서에 기록하지 않습니다.

## 개발과 확인

```bash
npm install
npm run dev
npm run lint:copy
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
```

- 로컬 게임: `http://localhost:5173`
- 데모: `?demo` 또는 `?demo=thanos`
- 아트 미리보기: `/preview.html`
- 현재 운영 검증: Vitest 706개, 운영 빌드, 문구 검사, 타입 검사, 운영 의존성 보안 취약점 0건

## 배포

정적 게임과 운영자 화면은 GitHub Pages, 로그인·데이터·동기화는 Supabase를 사용합니다. 운영 배포는 GitHub Actions의 `Deploy to GitHub Pages` 작업을 수동 실행하며, 프리뷰 확인과 운영 배포 승인 후 진행합니다.

배포할 때 필요한 공개 설정은 GitHub Actions Secrets에서 관리합니다. Supabase 서비스 역할 키, 운영자 비밀번호, 플레이어 PIN은 브라우저 번들이나 저장소에 넣지 않습니다.

## 이미지 교체

캐릭터나 타겟을 직접 만든 이미지로 바꾸려면 [ASSETS.md](./ASSETS.md)의 안내에 따라 투명 PNG를 `public/assets/`에 넣습니다. 이미지가 없으면 내장 두들 아트를 사용합니다.

## 기술 구성

Vite 5, TypeScript, Canvas 2D, rough.js, Web Audio, Vitest, GitHub Actions, GitHub Pages, Supabase Auth·Postgres·Edge Functions를 사용합니다.

```text
src/engine/     입력, 화면, 카메라, 파티클, 오디오
src/effects/    폭발, 균열, 충격파 등 공용 효과
src/targets/    부서지는 타겟과 순환
src/weapons/    파괴 방식 21종
src/progress/   기록, 도전, 도장, 저장
src/player/     프로필, 로그인, 동기화, 로그아웃
src/admin/      운영자 화면
src/ui/         게임 화면, 기록책, 알림, 공유
supabase/       DB 변경, 서버 함수, DB 테스트
```
