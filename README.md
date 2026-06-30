# 무엇이든 말해보살 · 자습관 피드백

정율사관학원 종합반 자습관 학생 피드백 수집 시스템.

- 학생용: https://jasup-feedback.web.app/
- 관리자: https://jasup-feedback.web.app/login.html
- 자습관별 QR 링크: `?room=1관` `?room=2관` `?room=3관` `?room=419관` `?room=블랙관` `?room=B7` `?room=B8` `?room=B9`

## 스택
- Firebase Hosting + Firestore (Standard, nam5/asia-northeast3)
- 정적 HTML/CSS/JS (Chart.js, Font Awesome)
- 6단계 위저드 폼 · localStorage 자동저장 · URL 파라미터 자습관 자동선택
- 관리자 대시보드: KPI / 자습관×카테고리 히트맵 / 12주 추세선 / 면담 워크플로우 / CSV export

## 배포
```sh
firebase deploy --only hosting
firebase deploy --only firestore:rules
```
