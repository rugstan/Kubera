// Shared auth types. Staff (admin, broker, analyst) sign in with an email
// one-time code or magic link and must complete TOTP MFA (aal2) before any
// deal-desk data loads. Portal users (borrower, partner) use the same sign-in
// without the MFA requirement and only ever see their own deals.

export const ROLES = ["admin", "broker", "analyst", "borrower", "partner"] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES = ["admin", "broker", "analyst"] as const satisfies readonly Role[];
export type StaffRole = (typeof STAFF_ROLES)[number];

export const PORTAL_ROLES = ["borrower", "partner"] as const satisfies readonly Role[];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isStaffRole(role: Role): role is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

/** Authenticator assurance level: aal1 = email code / link, aal2 = plus a verified TOTP factor. */
export type Aal = "aal1" | "aal2";

export type AuthUser = {
  id: string;
  email: string;
};

/** Tokens issued by the identity provider. Never sent to the browser except in an httpOnly cookie. */
export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  /** Epoch seconds when the access token expires. */
  expiresAt: number;
};

export type AuthSession = AuthTokens & {
  user: AuthUser;
  aal: Aal;
};

export type TotpFactor = {
  id: string;
  status: "verified" | "unverified";
  friendlyName?: string;
};

export type TotpEnrollment = {
  factorId: string;
  /** Base32 secret for manual entry. */
  secret: string;
  /** otpauth:// URI encoded in the QR code. */
  uri: string;
  /** Data URL of a QR code image when the provider renders one. */
  qrCode?: string;
};

export type DreLicenseType = "broker" | "salesperson" | "broker_officer";

export type Profile = {
  id: string;
  email: string;
  fullName: string | null;
  title: string | null;
  active: boolean;
  dreLicenseNumber: string | null;
  dreLicenseType: DreLicenseType | null;
  /** ISO date (YYYY-MM-DD). */
  dreLicenseExpiresOn: string | null;
  dreLicenseVerifiedAt: string | null;
};

/** The signed-in person as the staff app sees them. */
export type Principal = {
  userId: string;
  email: string;
  displayName: string;
  roles: Role[];
  aal: Aal;
  profile: Profile;
};

export type StaffPrincipal = Principal & { staffRoles: StaffRole[] };
