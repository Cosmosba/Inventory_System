import { env } from "./env.js";

/**
 * Options used when setting the session cookie after login.
 */
export function buildSessionCookieOptions(expiresAt: Date): object {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}

/**
 * Options used when clearing the session cookie on logout.
 * Must match the same name/path/sameSite/secure/domain as the set call so the
 * browser actually removes the cookie.
 */
export function clearSessionCookieOptions(): object {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  };
}
