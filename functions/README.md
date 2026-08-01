# 말해보살 알림 함수

새 학생 응답이 들어올 때마다 **텔레그램**(모든 응답)과 **이메일**(우선 처리 대상만) 알림을 발송합니다.

## 배포 순서

### 1) `.env` 파일 채워넣기

```
cp functions/.env.example functions/.env
```

그런 다음 `functions/.env` 를 편집기(VSCode 등)로 열어 준비한 값들을 채우세요:

```
TELEGRAM_BOT_TOKEN=발급받은_봇_토큰
TELEGRAM_CHAT_ID=본인_chat_id_숫자
RESEND_API_KEY=re_...
NOTIFY_EMAIL=수신할_개인_이메일
```

⚠️ **이 파일은 git에 커밋되지 않습니다.** 본인 컴퓨터에만 존재합니다.

### 2) 의존성 설치

```
cd functions
npm install
cd ..
```

### 3) 배포

```
firebase deploy --only functions
```

첫 배포는 5~10분 정도 걸립니다. 이후 재배포는 1~2분.

### 4) 테스트

`index.html` 에서 아무 응답이나 하나 제출해보세요. **몇 초 안에 텔레그램에 알림이 도착**하면 성공.

## 발송 조건

- **텔레그램**: 모든 응답 (요약형)
- **이메일**: 아래 중 하나라도 해당되면
  - 위험도 점수 ≥ 4
  - 위험 키워드 감지 (`힘들, 그만, 못 하겠, 자퇴, 우울, 죽고, 포기, 괴로, 싫어`)
  - `면담 희망` 체크

## 문제 해결

**텔레그램 알림이 안 옴**
- Firebase Console → Functions → 로그 확인
- `.env` 값이 배포에 반영됐는지: `firebase functions:config:get`
- 봇에게 먼저 `/start` 를 눌러 대화가 시작되어 있는지

**이메일이 스팸함으로 감**
- `onboarding@resend.dev` 는 검증된 도메인이지만 스팸 판정될 수 있음
- 스팸함에서 "스팸 아님" 표시 → 이후 정상 도착
- 근본 해결: Resend에 본인 도메인 인증 후 `EMAIL_FROM` 을 변경

**함수 실행 오류**
```
firebase functions:log --limit 20
```
