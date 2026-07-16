# INSSA Auth Flow Findings

## Summary

The staging authentication flow has been verified through live browser network observation against `https://staging.inssa.us`.

INSSA email/password sign-in uses Firebase Identity Toolkit first, then exchanges the Firebase token with the KBean staging backend hosted on Azure. A realistic k6 authentication test must execute the full sequence, not just the first Firebase request.

No secrets are included in this document.

## Source Evidence

- Live staging network capture through a fresh browser context.
- Existing QA harness auth flow in `pages/inssa/auth-page.ts`.
- Existing auth environment variables in `.env.inssa.live-staging` were used locally only and were not printed.

## Authentication Provider

- Primary identity provider: Firebase Identity Toolkit email/password.
- Backend session/profile layer: KBean staging backend on Azure.
- Staging frontend: `https://staging.inssa.us`.
- Staging backend: `https://kbeanbetastaging.azurewebsites.net`.

## Verified Sequence

### 1. Firebase Password Login

Request:

```text
POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<FIREBASE_API_KEY>
Content-Type: application/json
X-Firebase-GMPID: <FIREBASE_GMP_ID>
X-Client-Version: Chrome/JsCore/11.6.0/FirebaseCore-web
Origin: https://staging.inssa.us
```

Body:

```json
{
  "returnSecureToken": true,
  "email": "<REDACTED_EMAIL>",
  "password": "<REDACTED_PASSWORD>",
  "clientType": "CLIENT_TYPE_WEB"
}
```

Success criteria:

- HTTP `200`
- `idToken`
- `refreshToken`
- `localId`

### 2. Firebase Account Lookup

Request:

```text
POST https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=<FIREBASE_API_KEY>
Content-Type: application/json
```

Body:

```json
{
  "idToken": "<REDACTED_FIREBASE_ID_TOKEN>"
}
```

Success criteria:

- HTTP `200`
- `users[0].localId`

### 3. KBean SocialLoginJWT

Request:

```text
POST https://kbeanbetastaging.azurewebsites.net/Account/SocialLoginJWT
Content-Type: multipart/form-data
Origin: https://staging.inssa.us
Referer: https://staging.inssa.us/
```

Multipart fields:

```text
fbtoken=<REDACTED_FIREBASE_ID_TOKEN>
currentUser=<REDACTED_FIREBASE_USER_OBJECT>
hasSignedUpWithINSSA=true
password=
```

Success criteria:

- HTTP `200`
- response body is a JWT-like token

### 4. KBean SocialAuthenticate

Request:

```text
POST https://kbeanbetastaging.azurewebsites.net/Account/SocialAuthenticate
Content-Type: multipart/form-data
```

Multipart fields:

```text
fbtoken=<REDACTED_KBEAN_JWT>
```

Success criteria:

- HTTP `200`
- JSON response includes `token`

### 5. KBean Profile Lookup

Request:

```text
POST https://kbeanbetastaging.azurewebsites.net/api/public/GetUserProfileByEmail
Content-Type: application/json
apikey: <REDACTED_KBEAN_PUBLIC_API_KEY>
```

Body:

```json
{
  "EmailAddress": "<REDACTED_EMAIL>"
}
```

Success criteria:

- HTTP `200`
- profile body includes `id`, `emailAddress`, or `userName`

## Browser Success Indicators

- Final URL changed from `/signin` to `https://staging.inssa.us/`.
- Firebase auth state was written to local storage.
- KBean profile lookup returned the test user profile.

## k6 Suitability

The flow is suitable for protocol-level k6 testing only after the operator supplies the Firebase API key, Firebase GMP ID, KBean public API key, and dedicated staging test users through ignored local files or environment variables.

This test exercises Firebase and the Azure-hosted KBean backend. It should not be used for production or large staging profiles without explicit authorization and monitoring.
