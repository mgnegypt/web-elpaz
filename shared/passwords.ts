// Password quality rules shared by the server (which enforces them) and the
// dashboard (which shows the same wording).
//
// The 12-character minimum lives in the zod schemas. This adds the two things a
// length rule alone cannot catch: passwords built from obvious patterns, and a
// password equal to the account's own username or email.

/** Lower-cased, without spaces/punctuation, only for comparison. */
const squash = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, "");

const COMMON = new Set([
  "password",
  "password1",
  "password123",
  "password1234",
  "password12345",
  "passw0rd",
  "qwertyuiop",
  "qwerty123456",
  "123456789012",
  "1234567890123",
  "111111111111",
  "aaaaaaaaaaaa",
  "adminadminadmin",
  "administrator",
  "letmeinletmein",
  "iloveyouiloveyou",
  "welcome123456",
  "changemenow123",
  "elnab3lba2",
  "elbanelbaz",
  "elbanelbaz123",
  "qwertyqwerty",
  "abcabcabcabc",
  "asdfghjklasdfghjkl",
]);

/**
 * Returns an API error code when the password is unacceptable, or null when it
 * is good enough. Error codes are stable and translated by the dashboard.
 */
export function passwordProblem(
  password: string,
  identifiers: (string | null | undefined)[] = [],
): string | null {
  const value = squash(password);
  if (value.length < 12) return "password-too-short";
  if (COMMON.has(value) || COMMON.has(value.replace(/\d+$/, "")))
    return "password-too-common";
  // A doubled word ("passwordpassword") is just a short password twice.
  if (
    value.length % 2 === 0 &&
    value.slice(0, value.length / 2) === value.slice(value.length / 2)
  ) {
    return "password-too-common";
  }
  // A single repeated character (or a straight run like 012345678901) is not a secret.
  if (/^(.)\1+$/.test(value)) return "password-too-simple";
  if (/^(?:0123456789|1234567890|9876543210)+/.test(value))
    return "password-too-simple";
  for (const identifier of identifiers) {
    if (!identifier) continue;
    const candidate = squash(identifier);
    if (candidate.length < 4) continue;
    // Equal to the account name is always rejected. Long identifiers (the full
    // email, a long username) are also rejected as a substring; short generic
    // words like "owner" are not, so ordinary passwords aren't banned.
    if (value === candidate) return "password-matches-account";
    if (candidate.length >= 6 && value.includes(candidate))
      return "password-matches-account";
  }
  return null;
}
