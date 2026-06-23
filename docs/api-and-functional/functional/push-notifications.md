# Push Notifications

> **유형**: Explanation · **독자**: Level 2 · **읽는 시간**: ~10분

**설계 근거**: [`ADR-003 (-api / -impl 분리)`](../../philosophy/adr-003-api-impl-split.md) · [`ADR-011 (레이어드 + 포트/어댑터)`](../../philosophy/adr-011-layered-port-adapter.md) · [`ADR-034 (feature toggle)`](../../philosophy/adr-034-feature-toggle-lite-mode.md)

이 문서는 FCM 기반 푸시 알림 아키텍처와 디바이스 토큰 관리 방식을 설명합니다.

템플릿은 FCM(Firebase Cloud Messaging) 푸시 알림을 **Port/Adapter 패턴**으로 추상화합니다. 앱 도메인 코드는 FCM SDK 를 직접 알지 못하고 `PushPort` 인터페이스만 의존해요. 덕분에 테스트에서는 mock 으로, 로컬에서는 no-op 으로, 운영에서는 Firebase Admin SDK 로 바꿔 끼울 수 있습니다.

이 템플릿은 한 서버가 여러 앱을 서빙하는 멀티테넌트 모델이라, 푸시도 **앱별(슬러그별)로 격리**됩니다. 각 앱이 자기 Firebase 프로젝트와 service account 를 갖고, 발송 시점에 현재 [`appSlug`](../../reference/glossary.md#이-레포-고유-용어) 로 해당 앱의 자격을 골라 씁니다. 이 per-slug 발송이 본 도메인의 핵심이라 아래에서 따로 다뤄요.

---

## 한 문장 요약

`PushPort` 추상 위에 앱별 FCM 발송을 얹어, 디바이스 토큰 등록부터 무효 토큰 정리까지를 한 흐름으로 처리합니다.

---

## 아키텍처 개요

```
[앱 서비스] ──► PushService ──► PushPort ──► FcmPushAdapter ──► FCM (앱별 프로젝트)
                   │                   └──► NoOpPushAdapter (SDK 부재 시 폴백)
                   │
                   └─► DevicePort (유저의 push token 조회 + 무효 토큰 정리)
```

모듈 구성은 다음과 같습니다.

| 모듈 | 역할 |
|---|---|
| `core-device-api` | `DevicePort` 인터페이스, `DeviceDto`, `RegisterDeviceRequest` |
| `core-device-impl` | `DeviceServiceImpl`, `DeviceController`, `Device` 엔티티, `DeviceRepository` |
| `core-push-api` | `PushPort` 인터페이스, `PushMessage`, `PushSendResult` |
| `core-push-impl` | `FcmPushAdapter`, `NoOpPushAdapter`, `FcmMessagingFactory`, `PushAppCredentialProperties`, `PushService` |

디바이스 등록과 푸시 발송 책임은 의도적으로 분리되어 있습니다. 디바이스 도메인은 "유저가 어떤 기기를 갖고 있는가" 만 알고, 푸시 도메인은 "어떻게 메시지를 전달하는가" 만 압니다.

---

## 디바이스 등록 플로우

클라이언트(Flutter 앱) 는 FCM 토큰을 받은 뒤 백엔드에 등록합니다.

### 엔드포인트

경로는 `ApiEndpoints.Device.BASE` 상수로 관리됩니다.

```java
// common-web/ApiEndpoints.java 발췌
public static final String BASE = APP_BASE + "/devices";
// 실제 경로 예: /api/apps/gymlog/devices
```

### 요청

`RegisterDeviceRequest` 는 platform, pushToken, deviceName 을 받습니다.

```java
// core-device-api/dto/RegisterDeviceRequest.java 전체
public record RegisterDeviceRequest(
        @NotBlank String platform, String pushToken, @Size(max = 100) String deviceName) {}
```

`pushToken` 은 null 을 허용합니다. 토큰 발급 전에 디바이스만 먼저 등록해두고, 이후 토큰이 발급되면 같은 엔드포인트로 다시 호출해 갱신하는 흐름도 지원해요.

### 컨트롤러

```java
// core-device-impl/controller/DeviceController.java 발췌
@RestController
@RequestMapping(ApiEndpoints.Device.BASE)
public class DeviceController {

    private final DevicePort devicePort;

    @PostMapping
    public ApiResponse<DeviceDto> register(
            @PathVariable String appSlug,
            @CurrentUser AuthenticatedUser user,
            @RequestBody @Valid RegisterDeviceRequest request) {
        DeviceDto dto = devicePort.register(user.userId(), appSlug, request);
        return ApiResponse.ok(dto);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public ApiResponse<Void> unregister(
            @PathVariable long id, @CurrentUser AuthenticatedUser user) {
        devicePort.unregister(user.userId(), id);
        return ApiResponse.empty();
    }
}
```

`appSlug` 는 `register` 의 path variable 로 들어와 디바이스가 어느 앱 소속인지를 결정합니다. `unregister` 는 디바이스 `id` 만으로 식별하고, 소유권은 아래처럼 유저 ID 로 검증해요.

### Upsert 동작

`DeviceServiceImpl.register` 는 **`(userId, appSlug, platform)` 조합**을 기준으로 upsert 합니다. 같은 유저의 같은 플랫폼(iOS/Android) 기기는 하나의 row 로 관리됩니다.

```java
// core-device-impl/DeviceServiceImpl.java 발췌
public DeviceDto register(long userId, String appSlug, RegisterDeviceRequest request) {
    Device device = deviceRepository
            .findByUserIdAndAppSlugAndPlatform(userId, appSlug, request.platform())
            .orElseGet(() -> new Device(
                    userId, appSlug, request.platform(),
                    request.pushToken(), request.deviceName()));

    device.updatePushToken(request.pushToken());
    Device saved = deviceRepository.save(device);
    return toDto(saved);
}
```

앱을 재설치하거나 토큰이 로테이션되면 같은 platform 으로 다시 들어오므로, 새 row 가 쌓이지 않고 `push_token` 컬럼만 최신 값으로 덮어씁니다.

### unregister 권한 검증

`unregister` 는 soft delete 가 아니라 row 를 실제로 삭제합니다. 단, 호출자가 해당 디바이스의 **소유자인지 먼저 확인**해요. 다른 유저의 토큰을 강제로 해제하는 악용을 막기 위해서입니다.

```java
// core-device-impl/DeviceServiceImpl.java 발췌
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

엔티티는 `BaseEntity` 를 상속해 `id`, `createdAt`, `updatedAt` 을 공통으로 가집니다.

```java
// core-device-impl/entity/Device.java 발췌
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

`last_seen_at` 은 `onPrePersist` 와 `updatePushToken` 시점에 자동으로 갱신됩니다. 이 값은 마지막으로 앱이 활성 상태였던 시간을 나타내요.

테이블 스키마는 `new-app.sh` 가 앱 생성 시 자동으로 만듭니다. 모든 파생 앱이 똑같이 받는 인증 기반 마이그레이션의 하나로, `V006__init_devices.sql` 에 들어 있어요.

---

## PushPort 인터페이스

`PushPort` 는 세 가지 전송 방식을 제공합니다.

```java
// core-push-api/PushPort.java 발췌
public interface PushPort {

    PushSendResult sendToUser(long userId, PushMessage message);

    PushSendResult sendToDevices(List<String> pushTokens, PushMessage message);

    PushSendResult sendToTopic(String topic, PushMessage message);
}
```

| 메서드 | 용도 |
|---|---|
| `sendToUser` | 유저 ID 기반. 직접 호출하지 않고 `PushService` 를 거치는 게 원칙 |
| `sendToDevices` | 토큰 목록 기반. FCM multicast |
| `sendToTopic` | FCM topic 기반. 공지 등 fan-out |

`sendToUser` 는 인터페이스에 선언돼 있지만 `FcmPushAdapter` 에서는 경고 로그만 남기고 빈 결과를 돌려줘요. 유저 단위 발송은 토큰 조회가 먼저 필요해서, 그 책임을 가진 `PushService` 가 전담하기 때문입니다.

### PushMessage

알림 본문은 `PushMessage` 로 감쌉니다.

```java
// core-push-api/dto/PushMessage.java 전체
public record PushMessage(String title, String body, Map<String, String> data, String imageUrl) {}
```

`data` 는 FCM 의 custom data payload 로 전달됩니다. 클라이언트에서 알림을 탭했을 때 딥링크 URL 등을 실어 보낼 때 써요. `data` 와 `imageUrl` 은 null 을 허용합니다.

### PushSendResult

전송 결과는 성공/실패 카운트와 **무효 토큰 목록**을 함께 반환합니다.

```java
// core-push-api/dto/PushSendResult.java 전체
public record PushSendResult(int successCount, int failureCount, List<String> invalidTokens) {}
```

`invalidTokens` 는 FCM 이 `UNREGISTERED` 또는 `INVALID_ARGUMENT` 로 판정한 토큰입니다. 호출자는 이를 이용해 DB 에서 만료된 토큰을 정리해요.

---

## PushService 오케스트레이터

유저 레벨 발송은 `PushService` 를 거칩니다. `DevicePort.findPushTokensByUser` 로 토큰을 모은 뒤 `PushPort.sendToDevices` 에 위임하고, 무효 토큰은 자동으로 정리합니다.

```java
// core-push-impl/PushService.java 발췌
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

`removeInvalidTokens` 는 유저의 디바이스 목록(`DevicePort.findByUser`)을 훑어 `invalidTokens` 에 포함된 토큰을 가진 디바이스만 골라 `unregister` 합니다. 한 디바이스의 unregister 가 실패해도 나머지는 계속 정리하도록 개별 호출을 try-catch 로 감싸요.

앱 도메인 서비스가 푸시를 보낼 때는 **항상 `PushService` 를 주입받아** 쓰면 됩니다. 토큰 조회와 정리 책임이 자동으로 처리돼요.

---

## per-slug FCM 발송 — 앱별 격리

이 도메인에서 가장 중요한 부분입니다. 한 서버가 여러 앱을 서빙하지만 각 앱은 자기 Firebase 프로젝트를 가지므로, 발송 시점에 **현재 슬러그의 service account** 를 골라 써야 해요. 이 라우팅을 `SlugContext`, `PushAppCredentialProperties`, `FcmMessagingFactory`, `FcmPushAdapter` 네 조각이 나눠 맡습니다.

### 전체 흐름

```
부팅 시:
  PushAppCredentialProperties (app.credentials.<slug>.fcm-service-account-json)
     ↓
  FcmMessagingFactory.build  →  슬러그마다 named FirebaseApp + FirebaseMessaging
     ↓
  Map<slug, FirebaseMessaging>  →  FcmPushAdapter 에 주입

발송 시:
  PushService.sendToUser  →  DevicePort 토큰 조회 (schema-routed, SlugContext 세팅됨)
     ↓
  FcmPushAdapter.sendToDevices  →  SlugContext.get() 으로 현재 슬러그의 FirebaseMessaging 선택
     ↓
  해당 앱 프로젝트로 multicast 발송
```

### 자격 properties

앱별 service account 는 `app.credentials.<slug>` prefix 아래에 둡니다. OAuth(`AppCredentialProperties`) · IAP(`IapAppCredentialProperties`) 자격과 같은 prefix 를 공유하고, Spring 이 각 properties 클래스에 자기 필드만 바인딩해요.

```java
// core-push-impl/PushAppCredentialProperties.java 발췌
@ConfigurationProperties(prefix = "app")
public class PushAppCredentialProperties {

    private Map<String, PushCredential> credentials = new HashMap<>();

    public static class PushCredential {
        private String fcmServiceAccountJson;
        // getter/setter
    }
}
```

값은 service account 파일 경로가 아니라 **JSON 내용 전체**예요. env, GitHub Secret, Kamal 로 전달하기 위함이고, 멀티라인이 부담되면 한 줄 JSON 이나 base64 로 넣어도 됩니다.

```yaml
app:
  credentials:
    sumtally:
      fcm-service-account-json: '{"type":"service_account","project_id":"...", ...}'
```

`APP_CREDENTIALS_*` prefix 라 `init` 의 동적 secret push 루프가 이 키를 자동으로 발견해 업로드합니다.

### 슬러그별 FirebaseApp 빌드

`FcmMessagingFactory` 는 부팅 시 자격이 설정된 슬러그마다 name 이 슬러그인 `FirebaseApp` 을 초기화하고, 거기서 `FirebaseMessaging` 을 얻어 슬러그→messaging 맵을 만듭니다.

```java
// core-push-impl/FcmMessagingFactory.java 발췌
static Map<String, FirebaseMessaging> build(PushAppCredentialProperties props) {
    Map<String, FirebaseMessaging> bySlug = new HashMap<>();
    for (var entry : props.getCredentials().entrySet()) {
        String slug = entry.getKey();
        String saJson = entry.getValue().getFcmServiceAccountJson();
        if (saJson == null || saJson.isBlank()) {
            continue; // 이 앱은 FCM 미설정 — 발송 시 graceful no-op
        }
        FirebaseApp app = getOrInitApp(slug, saJson); // 이미 있으면 재사용 (멱등)
        bySlug.put(slug, FirebaseMessaging.getInstance(app));
    }
    return bySlug;
}
```

두 가지를 챙겨요. 같은 name 으로 이미 초기화된 `FirebaseApp` 이 있으면 `IllegalStateException` 을 잡아 기존 인스턴스를 재사용하므로 컨텍스트 재기동에 안전합니다. 그리고 자격 문자열은 `{` 로 시작하면 raw JSON, 그 외에는 base64 로 디코딩해요. `firebase-link` 가 기록하는 base64 형식이 `.env` 를 bash `source` 할 때 깨지지 않게 하려는 선택입니다.

### 발송 시점 라우팅

`FcmPushAdapter` 는 단일 `FirebaseMessaging` 이 아니라 슬러그→messaging 맵을 들고 있다가, 발송 직전에 `SlugContext` 로 현재 슬러그의 messaging 을 골라요.

```java
// core-push-impl/FcmPushAdapter.java 발췌
private FirebaseMessaging resolveMessaging() {
    String slug = SlugContext.get();
    if (slug == null) {
        log.warn("Push send attempted without SlugContext — skipped.");
        return null;
    }
    FirebaseMessaging firebaseMessaging = messagingBySlug.get(slug);
    if (firebaseMessaging == null) {
        log.warn("No FCM credentials configured for app slug={} — push skipped.", slug);
        return null;
    }
    return firebaseMessaging;
}
```

`SlugContext` 는 요청 진입 시 `AppSlugMdcFilter` 가 채우고 끝에서 비우는 ThreadLocal 이라, 발송 시점엔 항상 현재 앱 슬러그가 들어 있어요. 멀티테넌시 schema 라우팅(`SchemaRoutingDataSource`)이 쓰는 것과 같은 컨텍스트입니다.

슬러그가 없거나 그 앱의 FCM 자격이 없으면 `resolveMessaging` 이 null 을 반환하고, 호출부는 **graceful no-op** 으로 처리해요. 푸시 실패가 비즈니스 흐름을 깨뜨리지 않게, 예외를 던지는 대신 실패 카운트만 채운 결과를 돌려줍니다.

```java
// core-push-impl/FcmPushAdapter.java 발췌
public PushSendResult sendToDevices(List<String> pushTokens, PushMessage message) {
    if (pushTokens == null || pushTokens.isEmpty()) {
        return new PushSendResult(0, 0, List.of());
    }
    FirebaseMessaging firebaseMessaging = resolveMessaging();
    if (firebaseMessaging == null) {
        return new PushSendResult(0, pushTokens.size(), List.of());
    }
    // ... MulticastMessage 빌드 후 sendEachForMulticast ...
}
```

### 무효 토큰 판별

FCM 멀티캐스트 응답을 토큰 단위로 훑어, `UNREGISTERED`(앱 삭제 등으로 더 이상 유효하지 않음)와 `INVALID_ARGUMENT`(형식 오류)만 무효로 걸러냅니다.

```java
// core-push-impl/FcmPushAdapter.java 발췌
private boolean isInvalidTokenError(FirebaseMessagingException ex) {
    MessagingErrorCode code = ex.getMessagingErrorCode();
    return code == MessagingErrorCode.UNREGISTERED
            || code == MessagingErrorCode.INVALID_ARGUMENT;
}
```

그 외 에러(네트워크 일시 장애 등)는 `failureCount` 에만 집계되고 토큰은 유지돼요. 정상 토큰이 일시 장애로 사라지지 않게 하는 안전장치입니다.

---

## FCM 설정과 자동 구성

### 의존성

`core-push-impl` 은 Firebase Admin SDK 를 **`compileOnly`** 로 선언합니다. 발송이 실제로 필요한 배포 산출물(`bootstrap`)이 런타임에 SDK 를 제공해요.

```gradle
// core-push-impl/build.gradle 발췌
dependencies {
    api project(':core:core-push-api')
    api project(':core:core-device-api')        // DevicePort
    implementation project(':common:common-persistence')  // SlugContext (per-slug 라우팅)

    compileOnly libs.firebase.admin             // 버전은 gradle/libs.versions.toml
}
```

```gradle
// bootstrap/build.gradle 발췌
runtimeOnly libs.firebase.admin   // 배포 산출물이 SDK 를 런타임에 제공
```

### 자동 구성

`PushAutoConfiguration` 이 어댑터를 선택합니다. SDK 가 클래스패스에 있으면 `FcmPushAdapter` 를, 없으면 `NoOpPushAdapter` 를 등록해요.

```java
// core-push-impl/PushAutoConfiguration.java 발췌
@AutoConfiguration
@ConditionalOnProperty(prefix = "app.features", name = "push",
        havingValue = "true", matchIfMissing = true) // ADR-034 — 기본 활성
@EnableConfigurationProperties(PushAppCredentialProperties.class)
public class PushAutoConfiguration {

    @Bean
    @ConditionalOnClass(FirebaseMessaging.class)
    @ConditionalOnMissingBean(PushPort.class)
    public PushPort fcmPushAdapter(PushAppCredentialProperties props) {
        Map<String, FirebaseMessaging> messagingBySlug = FcmMessagingFactory.build(props);
        return new FcmPushAdapter(messagingBySlug);
    }

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

세 가지를 짚어둘게요.

- `app.features.push` 가 false 면 도메인 전체가 비활성화됩니다. 기본값은 활성이에요 ([`ADR-034`](../../philosophy/adr-034-feature-toggle-lite-mode.md) feature toggle).
- `FcmPushAdapter` 는 **자동으로 등록**됩니다. SDK 만 클래스패스에 있으면 되고, 소비자 앱이 직접 `@Bean` 으로 올릴 필요가 없어요. FCM 자격이 설정된 앱이 0개여도 빈은 등록되며, 미설정 슬러그는 발송 시 no-op 으로 빠집니다.
- `@ConditionalOnMissingBean(PushPort.class)` 덕분에 소비자 앱이 자기 `PushPort` 를 직접 등록하면 그게 우선합니다. 커스터마이즈 여지는 남겨둔 셈이에요.

---

## NoOpPushAdapter — 폴백

Firebase SDK 가 클래스패스에 없으면 `NoOpPushAdapter` 가 등록됩니다. 모든 메서드가 경고 로그만 남기고 빈 결과를 돌려줘요.

```java
// core-push-impl/NoOpPushAdapter.java 발췌
public PushSendResult sendToDevices(List<String> pushTokens, PushMessage message) {
    log.warn("NoOpPushAdapter: Firebase SDK not on classpath. "
            + "Push notification skipped for {} tokens", pushTokens.size());
    return new PushSendResult(0, 0, List.of());
}
```

테스트나 초기 개발 단계, 아직 Firebase 계정이 없을 때 유용해요. 운영에서 실제 발송이 필요하면 `bootstrap` 이 이미 SDK 를 런타임에 제공하므로 `FcmPushAdapter` 가 자동으로 활성화됩니다.

---

## 에러 처리

푸시 도메인은 전용 에러 enum 을 갖지 않습니다. `PushSendResult` 에 성공/실패 카운트가 담겨 돌아오는 것으로 충분하다고 봐요. 네트워크나 자격 증명 문제는 `FcmPushAdapter` 내부에서 로그로 남기고 `failureCount` 에 반영합니다.

디바이스 도메인도 별도 exception enum 이 없습니다. `unregister` 에서 대상이 없거나 권한이 없으면 공통 `CommonError.NOT_FOUND` 또는 `CommonError.FORBIDDEN` 을 써요. 푸시 토큰 자체는 값 객체일 뿐이라, 토큰 무효화는 **예외가 아니라 결과값(`invalidTokens`)** 으로 표현합니다.

---

## 요약

- `DevicePort` 로 디바이스를 등록·해제·조회합니다. upsert 는 `(userId, appSlug, platform)` 조합 기준이에요.
- `PushPort` 는 토큰·유저·토픽 세 가지 전송 방식을 제공합니다.
- `PushService` 가 유저 ID → 토큰 조회 → 전송 → 무효 토큰 정리를 오케스트레이션합니다.
- 발송은 **앱별로 격리**됩니다. `FcmMessagingFactory` 가 슬러그마다 `FirebaseApp` 을 만들고, `FcmPushAdapter` 가 `SlugContext` 로 현재 앱 자격을 골라 발송해요.
- SDK 가 있으면 `FcmPushAdapter` 가 자동 등록, 없으면 `NoOpPushAdapter` 폴백입니다. `app.features.push=false` 면 도메인 전체가 꺼져요.
- FCM 에러 중 `UNREGISTERED` 와 `INVALID_ARGUMENT` 만 토큰 무효로 판정합니다.

---

## 관련 문서

- [`Email Verification & Delivery`](./email-verification.md) — 이메일 알림 (푸시와 대조)
- [`Phone Auth (점유인증) & SMS`](./phone-auth-and-sms.md) — SMS OTP 점유인증 (같은 Port/Adapter 패턴)
- [`ADR-003 · core 모듈을 -api / -impl 로 분리`](../../philosophy/adr-003-api-impl-split.md) — PushPort 가 `-api` 모듈에 있는 근거
- [`ADR-011 · 모듈 안 레이어드 아키텍처 + 포트/어댑터 패턴`](../../philosophy/adr-011-layered-port-adapter.md) — 레이어드 + 포트/어댑터 패턴
- [`ADR-034 · feature toggle + Lite mode`](../../philosophy/adr-034-feature-toggle-lite-mode.md) — `app.features.push` 토글 근거
- [`JWT Authentication`](../../structure/jwt-authentication.md) — 디바이스 등록 시 인증 흐름
