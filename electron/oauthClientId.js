const MAX_OAUTH_CLIENT_ID_LENGTH = 512;

const normalizeClientId = (value, pattern, label) => {
  if (typeof value !== 'string') {
    throw new Error(`${label}の形式が不正です。`);
  }
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > MAX_OAUTH_CLIENT_ID_LENGTH
    || /[\u0000-\u001f\u007f]/.test(normalized)
    || !pattern.test(normalized)
  ) {
    throw new Error(`${label}の形式が不正です。`);
  }
  return normalized;
};

const normalizeGoogleClientId = value => normalizeClientId(
  value,
  /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/,
  'Google OAuthクライアントID'
);

const normalizeMicrosoftClientId = value => normalizeClientId(
  value,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'Microsoft OAuthクライアントID'
);

module.exports = {
  MAX_OAUTH_CLIENT_ID_LENGTH,
  normalizeGoogleClientId,
  normalizeMicrosoftClientId,
};
