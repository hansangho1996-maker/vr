# 🎼 악보 이조기

브라우저에서 바로 쓰는 악보 이조(조옮김) 프로그램입니다. 설치나 서버가 필요 없고, 파일은 외부로 전송되지 않습니다.

## 기능

| 구분 | 내용 |
|---|---|
| **오선 악보 (MusicXML)** | `.musicxml` / `.xml` / `.mxl` 파일을 열어 이조 → 화면에 악보 표시, MusicXML 다운로드, 인쇄/PDF 저장 |
| **코드 악보 (텍스트)** | 가사 위 코드 줄 형식과 `[C]가사` ChordPro 형식 모두 지원, 가사와의 칸 맞춤 유지 |
| **이조 방법** | 목표 조 선택(위/아래/가까운 쪽) · 반음 단위 이동 · 이조악기 프리셋(B♭ 트럼펫·클라리넷, 테너/알토/바리톤 색소폰, F 호른) |
| **올바른 음 표기** | 새 조표에 맞춰 음 이름을 정함 (예: C장조의 F♯ → B♭장조에서는 E♮, D♭장조로 가면 G♮) |
| **♯/♭ 선택** | 자동(조표가 적은 쪽) / ♯ 우선(C♯, F♯) / ♭ 우선(D♭, G♭) |

MusicXML에서는 조표, 음표(옥타브 포함), 임시표, 코드 심볼(근음·베이스음)을 모두 이조합니다.

## 실행

ES 모듈을 사용하므로 `index.html`을 파일로 바로 열지 말고 간단한 로컬 서버로 여세요.

```bash
python3 -m http.server 8080
# 또는
npm start
```

그다음 브라우저에서 <http://localhost:8080> 을 엽니다. GitHub Pages 같은 정적 호스팅에 그대로 올려도 동작합니다.

## 스캔 악보(이미지·PDF)는?

종이 악보 사진이나 PDF는 먼저 MusicXML로 변환해야 합니다.
MuseScore 4의 "PDF 가져오기"나 Audiveris(무료 OMR)로 변환한 뒤 이 프로그램에 넣으면 됩니다.

## 구조

```
index.html, style.css   화면
src/theory.js           조표·음 이름·이조 계산 (핵심 로직)
src/musicxml.js         MusicXML 이조
src/chords.js           코드 악보 텍스트 이조
src/app.js              화면 동작
test/                   단위 테스트 (npm test)
```

## 테스트

```bash
npm install
npm test
```
