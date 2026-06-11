const SENSITIVE_PATTERNS: RegExp[] = [
  /(INSSA_TEST_PASSWORD=)[^\s]+/gi,
  /(INSSA_SECONDARY_TEST_PASSWORD=)[^\s]+/gi,
  /(SIEM_WAZUH_TOKEN=)[^\s]+/gi,
  /(WAZUH_API_TOKEN=)[^\s]+/gi,
  /(WAZUH_TOKEN=)[^\s]+/gi,
  /(authorization:\s*bearer\s+)[^\s,]+/gi,
  /(token=)[^&\s"']+/gi,
  /(password["']?\s*[:=]\s*["']?)[^"',\s]+/gi
];

export function redactInssaLogLine(message: string) {
  return SENSITIVE_PATTERNS.reduce(
    (value, pattern) => value.replace(pattern, "$1[redacted]"),
    message
  );
}
