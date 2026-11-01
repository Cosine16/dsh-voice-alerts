/** Fixed phrases; no command, file contents, or model text is spoken. */
export const phrases = Object.freeze({
  authorization: 'Authorization required.',
  privilege: 'Elevated privileges required.',
  sensitive: 'Sensitive file access requested.',
  error: 'Error detected.',
  connectionLost: 'Connection lost.',
  subagentCreated: 'Subagent deployed.',
  subagentComplete: 'Subagent task complete.',
  taskComplete: 'Task complete.',
  inputRequired: 'Awaiting your instructions.',
  accessDenied: 'Access denied.',
  authorizationUnavailable: 'Authorization unavailable.',
  requestTimeout: 'Request timed out.',
  authenticationFailed: 'Authentication failed.',
  rateLimited: 'Rate limit reached.',
  retrying: 'Retrying request.',
  connectionRestored: 'Connection restored.',
  requestRecovered: 'Request recovered.',
  subagentFailed: 'Subagent failed.',
  taskCancelled: 'Task cancelled.',
  taskStopped: 'Task stopped.',
  tokenLimit: 'Token limit reached.',
  taskBlocked: 'Task blocked.',
  objectiveBlocked: 'Objective blocked.',
  objectiveComplete: 'Objective complete.',
  compactionFailed: 'Context compression failed.',
  toolFailed: 'Tool execution failed.',
});

/** Validate user-editable settings before registering listeners. */
export function validateConfig(config) {
  if (typeof config.enabled !== 'boolean') throw new Error('enabled must be a boolean');
  const ranges = { volume: [0, 100], cooldownMs: [0, 600000], approvalDelayMs: [0, 60000], maxQueue: [1, 100], playbackTimeoutMs: [1000, 60000], maxAlertAgeMs: [1000, 300000], playbackFailureCooldownMs: [1000, 300000], errorCoalesceMs: [0, 5000] };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) throw new Error(`${key} must be an integer from ${min} to ${max}`);
  }
  for (const key of Object.keys(phrases)) {
    if (typeof config.events?.[key] !== 'boolean') throw new Error(`events.${key} must be a boolean`);
  }
  return config;
}

/** Approval categories are hints from the request reason, not OS privilege detection. */
export function approvalKind(request) {
  const reason = request.reason ?? '';
  if (/sensitive|secret|credential|private.key|敏感|凭据|私钥/i.test(reason)) return 'sensitive';
  if (/\bsudo\b|\badministrator\b|\badmin\b|\belevat\w*|\bprivilege\w*|管理员|提权|超级用户/i.test(reason)) return 'privilege';
  return 'authorization';
}

/** Only provider-declared network failures are called connection loss. */
export function failureKind(failure) {
  if (failure?.status === 401 || ['HTTP_401', 'UNAUTHORIZED', 'AUTHENTICATION_FAILED', 'INVALID_API_KEY'].includes(failure?.code)) return 'authenticationFailed';
  if (failure?.status === 429 || ['HTTP_429', 'RATE_LIMITED', 'RATE_LIMIT'].includes(failure?.code)) return 'rateLimited';
  if (['TIMEOUT', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(failure?.code)) return 'requestTimeout';
  return ['TRANSPORT', 'NETWORK', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(failure?.code)
    ? 'connectionLost' : 'error';
}
