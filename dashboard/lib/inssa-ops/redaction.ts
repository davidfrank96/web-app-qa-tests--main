const SENSITIVE_RULES: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /((?:^|\s)[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|PRIVATE_KEY|SERVICE_ROLE_KEY|COOKIE|SESSION_ID)[A-Z0-9_]*=)[^\s]+/gi,
    replacement: "$1[redacted]"
  },
  {
    pattern: /(["'](?:password|secret|privateKey|serviceRoleKey|accessToken|refreshToken|idToken|authorization|cookie|sessionId)["']\s*[:=]\s*["'])[^"']+(["'])/gi,
    replacement: "$1[redacted]$2"
  },
  {
    pattern: /((?:authorization|proxy-authorization):\s*(?:bearer|basic)\s+)[^\s,]+/gi,
    replacement: "$1[redacted]"
  },
  {
    pattern: /((?:set-cookie|cookie):\s*)[^\r\n]+/gi,
    replacement: "$1[redacted]"
  },
  {
    pattern: /([?&](?:token|access_token|id_token|refresh_token|auth|code|signature|sig|x-amz-signature|x-amz-credential|api_key|apikey|key|password)=)[^&#\s"']+/gi,
    replacement: "$1[redacted]"
  },
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
    replacement: "Bearer [redacted]"
  },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: "[redacted-jwt]"
  },
  {
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    replacement: "[redacted-private-key]"
  }
];

export function redactInssaLogLine(message: string) {
  return SENSITIVE_RULES.reduce(
    (value, rule) => value.replace(rule.pattern, rule.replacement),
    message
  );
}

export function redactInssaTextOutput(body: Buffer | string) {
  return redactInssaLogLine(typeof body === "string" ? body : body.toString("utf8"));
}

export function isRedactableContentType(contentType: string) {
  return /^(?:application\/(?:json|manifest\+json)|text\/(?:html|markdown|plain))(?:;|$)/i.test(contentType);
}
