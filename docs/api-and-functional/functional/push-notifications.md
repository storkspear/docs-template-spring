# Push Notifications

> **유형**: Explanation · **독자**: Level 2 · **읽는 시간**: ~10분

**설계 근거**: [ADR-003 (-api / -impl 분리)](../../philosophy/adr-003-api-impl-split.md) · [ADR-011 (레이어드 + 포트/어댑터)](../../philosophy/adr-011-layered-port-adapter.md)

이 문서는 푸시 알림 아키텍처와 디바이스 토큰 관리 방식을 정리합니다.

템플릿은 FCM(Firebase Cloud Messaging) 기반 푸시 알림을 **Port/Adapter 패턴**으로 추상화합니다. 앱 도메인 코드는 FCM SDK 를 직접 알지 못하고 `PushPort` 인터페이스만 의존합니다. 덕분에 테스트에서는 mock 으로, 로컬에서는 no-op 으로, 운영에서는 Firebase Admin SDK 로 바꿔 끼울 수 있습니다.

---

## 한 문장 요약

이 문서는 **FCM 기반 푸시 알림** 아키텍처와 디바이스 토큰 관리 방식을 설명합니다. `PushPort` 추상 + `FcmPushAdapter` 구현 + 디바이스 등록 플로우.

---

## 아키텍처 개요

```
[앱 서비스] ──► PushService ──► PushPort ──► FcmPushAdapter ──► FCM
                   │                   └──► NoOpPushAdapter (SDK 부재 시 fallback)
                   │
                   └─► DevicePort (유저의 push token 조회 + 무효 토큰 정리)
```

모듈 구성은 다음과 같습니다.

| 모듈 | 역할 |
|---|---|
| `core/core-device-api` | `DevicePort` 인터페이스, `DeviceDto`, `RegisterDeviceRequest` |
| `core/core-device-impl` | `DeviceServiceImpl`, `DeviceController`, `Device` 엔티티, `DeviceRepository` |
| `core/core-push-api` | `PushPort` 인터페이스, `PushMessage`, `PushSendResult` |
| `core/core-push-impl` | `FcmPushAdapter`, `NoOpPushAdapter`, `FcmProperties`, `PushService` |

디바이스 등록과 푸시 발송 책임은 의도적으로 분리되어 있습니다. 디바이스 도메인은 **"유저가 어떤 기기를 갖고 있는가"** 만 알고, 푸시 도메인은 **"어떻게 메시지를 전달하는가"** 만 압니다.

---

## 디바이스 등록 플로우

클라이언트(Flutter 앱) 는 FCM 토큰을 받은 뒤 백엔드에 등록합니다.

### 엔드포인트

`ApiEndpoints.Device.BASE` 상수로 관리됩니다.

```java
public static final String BASE = APP_BASE + "/devices";
// 실제 경로 예: /api/apps/gymlog/devices
```

### 요청

`RegisterDeviceRequest` 는 plaform, pushToken, deviceName 을 받습니다.

```java
// core/core-device-api/src/main/java/com/factory/core/device/api/dto/RegisterDeviceRequest.java
public record RegisterDeviceRequest(
        @NotBlank String platform,
        String pushToken,
        @Size(max = 100) String deviceName
) {}
```

`pushToken` 은 null 을 허용합니다. 토큰 발급 전에 디바이스만 먼저 등록해두고, 이후 토큰이 발급되면 같은 엔드포인트로 다시 호출하여 갱신하는 플로우도 지원합니다.

### 컨트롤러

```java
// core/core-device-impl/src/main/java/com/factory/core/device/impl/controller/DeviceController.java
@RestController
@RequestMapping(ApiEndpoints.Device.BASE)
public class DeviceController {

    private final DevicePort devicePort;

    @PostMapping
    public ApiResponse<DeviceDto> register(
            @PathVariable String appSlug,
            @CurrentUser AuthenticatedUser user,
            @RequestBody @Valid RegisterDeviceRequest request
    ) {
        DeviceDto dto = devicePort.register(user.userId(), appSlug, request);
        return ApiResponse.ok(dto);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public ApiResponse<Void> unregister(
            @PathVariable String appSlug,
            @PathVariable long id,
            @CurrentUser AuthenticatedUser user
    ) {
        devicePort.unregister(user.userId(), id);
        return ApiResponse.empty();
    }
}
```

### Upsert 동작

`DeviceServiceImpl.register` 는 **`(userId, appSlug, platform)` 조합**을 기준으로 upsert 합니다. 즉 같은 유저의 같은 기기(iOS/Android) 는 하나의 row 로 관리됩니다.

```java
// core/core-device-impl/src/main/java/com/factory/core/device/impl/DeviceServiceImpl.java
public DeviceDto register(long userId, String appSlug, RegisterDeviceRequest request) {
    Device device = deviceRepository
            .findByUserIdAndAppSlugAndPlatform(userId, appSlug, request.platform())
            .orElseGet(() -> new Device(userId, appSlug, request.platform(), request.pushToken(), request.deviceName()));

    device.updatePushToken(request.pushToken());
    Device saved = deviceRepository.save(device);
    return toDto(saved);
}
```

앱을 재설치하거나 토큰이 로테이션되면 같은 platform 으로 다시 들어오므로, 새 row 가 쌓이지 않고 `push_token` 컬럼만 최신 값으로 덮어씁니다.

### unregister 권한 검증

`unregister` 는 soft delete 가 아니라 row 를 실제로 삭제합니다. 단, 호출자가 해당 디바이스의 **소유자인지 먼저 확인**합니다. 다른 유저 토큰을 강제로 해제하는 악용을 막기 위해서입니다.

```java
public void unregister(long userId, long deviceId) {
    Device device = deviceRepository.findById(deviceId)
            .orElseThrow(() -> new CommonException(CommonError.NOT_FOUND,
                    Map.of("resource", "Device", "id", String.valueOf(deviceId))));

    if (!device.getUserId().equals(userId)) {
        throw new CommonException(CommonError.FORBIDDEN);
    }

    deviceRepository.delete(device);
}
```

---

## 디바이스 엔티티와 테이블

엔티티는 `BaseEntity` 를 상속하여 `id`, `createdAt`, `updatedAt` 을 공통으로 가집니다.

```java
// core/core-device-impl/src/main/java/com/factory/core/device/impl/entity/Device.java
@Entity
@Table(name = "devices")
public class Device extends BaseEntity {

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "app_slug", nullable = false, length = 50)
    private String appSlug;

    @Column(nullable = false, length = 10)
    private String platform;

    @Column(name = "push_token", length = 512)
    private String pushToken;

    @Column(name = "device_name", length = 100)
    private String deviceName;

    @Column(name = "last_seen_at")
    private Instant lastSeenAt;
    // ...
}
```

`last_seen_at` 은 `onPrePersist` 와 `updatePushToken` 시점에 자동으로 갱신됩니다. 이 값은 "마지막으로 앱이 활성 상태였던 시간" 을 나타냅니다.

테이블 스키마는 `new-app.sh` 가 앱 생성 시 자동으로 만듭니다 (`V006__init_devices.sql`).

---

## PushPort 인터페이스

`PushPort` 는 세 가지 전송 방식을 제공합니다.

```java
// core/core-push-api/src/main/java/com/factory/core/push/api/PushPort.java
public interface PushPort {

    PushSendResult sendToUser(long userId, PushMessage message);

    PushSendResult sendToDevices(List<String> pushTokens, PushMessage message);

    PushSendResult sendToTopic(String topic, PushMessage message);
}
```

| 메서드 | 용도 |
|---|---|
| `sendToUser` | 유저 ID 기반 — 내부적으로 `PushService` 가 토큰 조회 후 위임 |
| `sendToDevices` | 토큰 목록 기반 — FCM multicast |
| `sendToTopic` | FCM topic 기반 — 공지 등 fan-out |

### PushMessage

알림 본문은 `PushMessage` 로 감쌉니다.

```java
public record PushMessage(
        String title,
        String body,
        Map<String, String> data,
        String imageUrl
) {}
```

`data` 는 FCM 의 custom data payload 로 전달됩니다. 클라이언트에서 알림을 탭했을 때 딥링크 URL 등을 실어 보낼 때 씁니다.

### PushSendResult

전송 결과는 성공/실패 카운트와 **무효 토큰 목록**을 함께 반환합니다.

```java
public record PushSendResult(
        int successCount,
        int failureCount,
        List<String> invalidTokens
) {}
```

`invalidTokens` 는 FCM 이 `UNREGISTERED` / `INVALID_ARGUMENT` 로 판정한 토큰입니다. 호출자는 이를 이용해 DB 에서 만료된 토큰을 정리합니다.

---

## PushService 오케스트레이터

유저 레벨 발송은 `PushService` 를 거칩니다. `DevicePort.findPushTokensByUser` 로 토큰을 모은 뒤 `PushPort.sendToDevices` 에 위임하고, **무효 토큰은 자동으로 unregister** 합니다.

```java
// core/core-push-impl/src/main/java/com/factory/core/push/impl/PushService.java
public PushSendResult sendToUser(long userId, PushMessage message) {
    List<String> tokens = devicePort.findPushTokensByUser(userId);
    if (tokens.isEmpty()) {
        log.debug("No push tokens found for userId={}", userId);
        return new PushSendResult(0, 0, List.of());
    }

    PushSendResult result = pushPort.sendToDevices(tokens, message);

    // 만료된 토큰 정리
    if (!result.invalidTokens().isEmpty()) {
        log.info("Removing {} invalid push tokens for userId={}",
                result.invalidTokens().size(), userId);
        removeInvalidTokens(userId, result.invalidTokens());
    }

    return result;
}
```

앱 도메인 서비스가 푸시를 보낼 때는 **항상 `PushService` 를 주입받아** 사용하면 됩니다. 토큰 조회/정리 책임이 자동으로 처리됩니다.

---

## FcmPushAdapter — FCM 구현체

Firebase Admin SDK 의 `FirebaseMessaging` 을 주입받아 실제 전송을 수행합니다.

```java
// core/core-push-impl/src/main/java/com/factory/core/push/impl/FcmPushAdapter.java
public class FcmPushAdapter implements PushPort {

    private final FirebaseMessaging firebaseMessaging;

    @Override
    public PushSendResult sendToDevices(List<String> pushTokens, PushMessage message) {
        MulticastMessage multicastMessage = MulticastMessage.builder()
                .addAllTokens(pushTokens)
                .setNotification(Notification.builder()
                        .setTitle(message.title())
                        .setBody(message.body())
                        .setImage(message.imageUrl())
                        .build())
                .putAllData(message.data() != null ? message.data() : Map.of())
                .build();

        BatchResponse response = firebaseMessaging.sendEachForMulticast(multicastMessage);
        List<String> invalidTokens = new ArrayList<>();
        List<SendResponse> responses = response.getResponses();
        for (int i = 0; i < responses.size(); i++) {
            SendResponse sendResponse = responses.get(i);
            if (!sendResponse.isSuccessful()) {
                FirebaseMessagingException ex = sendResponse.getException();
                if (ex != null && isInvalidTokenError(ex)) {
                    invalidTokens.add(pushTokens.get(i));
                }
            }
        }
        return new PushSendResult(response.getSuccessCount(),
                response.getFailureCount(), invalidTokens);
    }

    private boolean isInvalidTokenError(FirebaseMessagingException ex) {
        MessagingErrorCode code = ex.getMessagingErrorCode();
        return code == MessagingErrorCode.UNREGISTERED
                || code == MessagingErrorCode.INVALID_ARGUMENT;
    }
}
```

**토큰 무효 판별 규칙**은 FCM 이 반환하는 `MessagingErrorCode` 중 `UNREGISTERED`(앱 삭제 등으로 토큰이 더 이상 유효하지 않음) 와 `INVALID_ARGUMENT`(형식 오류) 만 걸러냅니다. 그 외 에러(네트워크 일시 장애 등)는 `failureCount` 에만 집계되고 토큰은 유지됩니다. 정상 토큰이 네트워크 장애로 사라지지 않도록 하는 안전장치입니다.

---

## FCM 설정

### 의존성

`core-push-impl` 은 Firebase Admin SDK 를 **`compileOnly`** 로 선언합니다. 소비자 앱이 런타임에 제공해야 `FcmPushAdapter` 가 활성화됩니다.

```gradle
// core/core-push-impl/build.gradle
dependencies {
    api project(':core:core-push-api')
    api project(':core:core-device-api')

    compileOnly 'com.google.firebase:firebase-admin:9.8.0'
}
```

### FcmProperties

credential JSON 파일 경로를 받습니다.

```java
// core/core-push-impl/src/main/java/com/factory/core/push/impl/FcmProperties.java
@ConfigurationProperties("app.push.fcm")
public record FcmProperties(String credentialsPath) {
    public FcmProperties {
        Objects.requireNonNull(credentialsPath,
                "app.push.fcm.credentials-path must be configured");
    }
}
```

### application.yml

```yaml
app:
  push:
    fcm:
      credentials-path: /secrets/firebase-service-account.json
```

credential JSON 은 Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → "새 비공개 키 생성" 으로 발급합니다. 운영에서는 비밀 값 관리 도구(예: Docker secret, Kubernetes secret) 로 마운트하고, 로컬 개발에서는 gitignore 된 경로에 두는 것이 안전합니다.

---

## NoOpPushAdapter — 폴백

Firebase SDK 가 클래스패스에 없으면 `PushAutoConfiguration` 이 `NoOpPushAdapter` 를 대신 등록합니다.

```java
// core/core-push-impl/src/main/java/com/factory/core/push/impl/NoOpPushAdapter.java
public class NoOpPushAdapter implements PushPort {

    @Override
    public PushSendResult sendToDevices(List<String> pushTokens, PushMessage message) {
        log.warn("NoOpPushAdapter: Firebase SDK not on classpath. "
                + "Push notification skipped for {} tokens", pushTokens.size());
        return new PushSendResult(0, 0, List.of());
    }
    // ...
}
```

경고 로그만 남기고 빈 결과를 반환합니다. 테스트나 초기 개발 단계(아직 Firebase 계정이 없을 때)에 유용합니다.

### 자동 구성

```java
// core/core-push-impl/src/main/java/com/factory/core/push/impl/PushAutoConfiguration.java
@AutoConfiguration
public class PushAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean(PushPort.class)
    public PushPort noOpPushAdapter() {
        return new NoOpPushAdapter();
    }

    @Bean
    @ConditionalOnMissingBean
    public PushService pushService(DevicePort devicePort, PushPort pushPort) {
        return new PushService(devicePort, pushPort);
    }
}
```

`FcmPushAdapter` 는 자동 등록되지 **않습니다**. 소비자 앱이 `FirebaseMessaging` 빈과 함께 `FcmPushAdapter` 를 직접 `@Bean` 으로 올려야 합니다. Firebase 초기화 정책(FirebaseApp 인스턴스 공유, 자격 증명 로딩 등) 은 앱마다 다르기 때문에, 템플릿이 정책을 강요하지 않고 소비자가 결정하도록 둡니다.

---

## 에러 처리

푸시 도메인은 전용 에러 enum 을 갖지 않습니다. `PushSendResult` 에 성공/실패 카운트가 담겨 돌아오는 것으로 충분하다고 봅니다. 네트워크/자격 증명 문제는 `FcmPushAdapter` 내부에서 로그로 남기고 `failureCount` 에 반영합니다.

디바이스 도메인도 별도 exception enum 이 없습니다. `unregister` 에서 대상이 없거나 권한이 없을 때는 공통 `CommonError.NOT_FOUND` / `CommonError.FORBIDDEN` 을 씁니다. 푸시 토큰 자체는 값 객체일 뿐이므로, 토큰 무효화는 **예외가 아니라 결과값(`invalidTokens`)** 으로 표현합니다.

---

## 요약

- `DevicePort` 로 디바이스를 등록/해제/조회합니다. upsert 는 `(userId, appSlug, platform)` 조합 기준입니다.
- `PushPort` 는 토큰/유저/토픽 세 가지 전송 방식을 제공합니다.
- `PushService` 가 유저 ID → 토큰 조회 → 전송 → 무효 토큰 정리를 오케스트레이션합니다.
- 운영은 `FcmPushAdapter` + Firebase Admin SDK, 개발은 `NoOpPushAdapter` fallback 으로 자동 전환됩니다.
- FCM 에러 중 `UNREGISTERED` / `INVALID_ARGUMENT` 만 토큰 무효로 판정합니다.

---

## 관련 문서

- [Email Verification & Delivery](./email-verification.md) — 이메일 알림 (푸시와 대조)
- [ADR-003 · core 모듈을 `-api` / `-impl` 로 분리](../../philosophy/adr-003-api-impl-split.md) — PushPort 가 `-api` 모듈에 있는 근거
- [ADR-011 · 모듈 안 레이어드 아키텍처 + 포트/어댑터 패턴](../../philosophy/adr-011-layered-port-adapter.md) — 레이어드 + 포트/어댑터 패턴
- [JWT Authentication](../../structure/jwt-authentication.md) — 디바이스 등록 시 인증 흐름
