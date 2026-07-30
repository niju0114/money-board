# 민준의 돈

개인 원장(가계부) PWA. Vite + React + Tailwind CSS v4로 만든 순수 정적 앱이며,
데이터는 브라우저 localStorage(키: `minjun-money-v1`)에만 저장됩니다. 외부 API 호출 없음.

## 개발

```bash
npm install
npm run dev
```

→ http://localhost:5173/money-board/ 에서 확인합니다 (base 경로 때문에 `/money-board/`가 붙습니다).

## 빌드 / 로컬 확인

```bash
npm run build
npm run preview
```

## GitHub Pages 배포

1. GitHub에 **`money-board`** 라는 이름으로 저장소를 만듭니다.
   (vite base가 `/money-board/`라서, 저장소 이름을 바꾸면 `vite.config.js`의 `base`도 같이 바꿔야 합니다)
2. 리모트 연결 후 push:

   ```bash
   git remote add origin https://github.com/<계정>/money-board.git
   git push -u origin main
   ```

3. 첫 push 때 워크플로가 Pages를 자동 활성화합니다(`configure-pages`의 `enablement: true`).
   만약 배포 job이 실패하면 **Settings → Pages → Source: GitHub Actions**로 설정돼 있는지 확인 후 Actions 탭에서 Re-run 하세요.
   이후 main에 푸시할 때마다 자동 배포됩니다.

배포 주소: `https://<계정>.github.io/money-board/`

## 폰 홈 화면에 추가 (PWA)

배포 주소를 폰 브라우저로 열고 **"홈 화면에 추가"**(Android Chrome) 또는 **공유 → 홈 화면에 추가**(iOS Safari)를 누르면
독립 앱처럼 설치되고, 한 번 연 뒤에는 오프라인에서도 열립니다.

## 앱 아이콘 다시 만들기

`public/`의 PNG 아이콘은 의존성 없는 스크립트로 재생성할 수 있습니다:

```bash
npm run icons
```
