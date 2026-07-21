# GDPR / 개인정보 열람·삭제 요청 대응 runbook

> **유형**: Runbook · **독자**: 1인 운영자 · **범위**: 앱 사용자(앱별 schema)의 개인정보 열람(export)·삭제(erasure) 요청 처리.
>
> ⚠️ **법적 근거 문구·보존기간은 초안입니다 — 시행 전 법무(또는 최소한 조문 원문) 확인 필요.** 아래 §5 참조.

운영 콘솔 계정(admin schema)은 앱 사용자 GDPR 범위 밖이라 본 문서 대상이 아니에요(별도 절차). 엔드포인트 계약은 [`admin-console.md`](../api-and-functional/admin-console.md) §4-5-1/§4-5-2, 에러코드는 [`exception-handling.md`](../convention/exception-handling.md) 참조.

---

## 1. 표준 플로우 (접수 → 회신)

| 단계 | 내용 |
|---|---|
| 1. 접수 | 지원 이메일로만 요청 수신(앱 문의 채널 포함 시 동일 절차). **접수일 기록** — 회신 기한 기산점. |
| 2. 본인확인 1차 | 요청 발신 주소 = 계정 가입 email 일치 확인. |
| 3. 본인확인 2차 (항상) | 가입 email 로 6자리 확인 코드 발송 → 요청자 회신 → 대조. 발신 주소 위조 차단. |
| 4. 예외 | 가입 email 접근 불가 주장 시: 계정만 아는 정보 대조(가입 시기·최근 결제 금액 일부·소셜 로그인 제공자). 불충분하면 **거절**(과잉 제공보다 안전). |
| 5. 처리 | 아래 §2(export) / §3(delete). |
| 6. 기한 | 접수 후 **30일 이내** 회신(GDPR Art.12(3) 1개월 — 복잡 시 +2개월 연장 통지 가능. 국내 개인정보보호법은 "지체 없이" — *초안*). |
| 7. 기록 | export 는 `user_read_history`(EXPORT) + `audit_logs` 자동. 접수·회신 일자는 이메일 스레드 보존(30일 기한 관리). |

---

## 2. 열람(export) 처리

1. 콘솔 사용자 상세 → **"개인정보 내보내기(JSON)"** — `GET /api/admin/apps/{slug}/users/{userId}/export`.
2. 권한: `PERM_USERS_UNMASK`(전 PII 원본). 없으면 403.
3. 반환된 JSON 번들을 **가입 email 로만** 발송. 첨부 파일 실체는 미포함(메타의 `storageKey` 로 파일 화면에서 개별 다운로드).
4. 발급 사실은 `user_read_history.resource_type='EXPORT'` + 감사로그에 자동 기록.

---

## 3. 삭제(erasure) 처리 — soft-delete → 30일 유예 → 익명화 배치

1. 콘솔 삭제 버튼 → `DELETE /api/admin/apps/{slug}/users/{userId}`(권한 `PERM_USERS_WRITE`). soft-delete(`deleted_at`) + refresh token 전체 revoke.
2. 요청자에게 **"30일 내 재로그인 시 복구 문의 가능, 이후 복구 불가"** 고지.
3. 30일 유예 경과 후 `UserErasureScheduler`(기본 05:00)가 도메인별로 완전삭제/익명화.

### 3.1 배치 활성 조건 · 프로퍼티

| 프로퍼티 | 기본 | 설명 |
|---|---|---|
| `app.user.erasure.enabled` | (미설정=off) | `true` 일 때만 스케줄러 Bean 등록(운영에서만 권장 — 첨부/감사 purge 관행 동일) |
| `app.user.erasure.cron` | `0 0 5 * * *` | 매일 05:00(04:00 첨부·04:30 감사 sweep 와 분리) |
| `app.user.erasure.grace-days` | `30` | soft-delete 후 유예일수. `deleted_at + grace <= now` 이면 대상 |

- 멱등 완료 표식은 익명화 email 마커(`deleted-{id}@erased.invalid`). 재실행 시 배제.
- **ACTIVE 구독**이 남은 사용자는 스킵 + WARN 로그 — 운영자가 구독 정리 후 다음 sweep 에서 처리.

### 3.2 도메인별 처리 (plan §1.3)

| 처리 | 대상 |
|---|---|
| **hard delete** | auth 토큰류(refresh·email·password)·social identities·devices·notification settings·activity days·email/phone 인증코드 |
| **익명화 (row 보존)** | `users`(email→마커 + password_hash/display_name/nickname/totp 소거) · `payment_history`(`raw_response`/`customer_uid` 만 제거) · `posts`(`author_nickname`) · `analytics_events`(`user_id`→NULL) |
| **보존 (변경 없음)** | `subscriptions` · `payment_refunds` · `payment_webhook_events` · `audit_logs`/archive · `user_read_history` · `message_send_history` — 결제·감사 원장 무결성(식별성은 `users` 익명화로 절단) |
| **soft-delete → 기존 purge 낙수** | `attachment_file` — `AttachmentPort.softDelete`(purge_at=now+30일) 전환 후 **~30일 뒤(purge retention)** `AttachmentPurgeScheduler` 가 스토리지 오브젝트 + row 삭제 |

---

## 4. 셀프서비스 관련

앱 내 계정 삭제는 기존 `POST /auth/withdraw`(flutter 탈퇴 UI)가 이미 접수 역할을 해요 — 본 erasure 배치가 붙는 순간 "탈퇴 = 30일 후 완전삭제/익명화"가 완성됩니다(별도 셀프서비스 API 불필요, 앱 내 고지 문구만 필요). Apple token revoke(App Store 5.1.1(v))는 미이행(backlog).

---

## 5. 법적 근거 (초안 — 법무 확인 전)

- 결제·구독·감사 원장의 **보존**: GDPR Art.17(3)(b) 법적 의무 예외 + 전자상거래법 제6조(대금결제·재화공급 기록 5년, 계약·청약철회 5년) — *조문·기간은 법무 확인 전 초안*.
- 열람 기한: GDPR Art.12(3) 1개월(+2개월 연장 가능). 국내 개인정보보호법 "지체 없이".
- 유예 30일·"복구 가능" 고지 문구는 약관/개인정보처리방침과 정합 확인 필요.
