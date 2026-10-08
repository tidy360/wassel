import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";

if (!JWT_SECRET) {
  // Fail loudly at boot rather than silently signing tokens with "undefined".
  throw new Error("JWT_SECRET is not set. Refusing to start.");
}

export interface AuthTokenPayload {
  userId: string;
  tenantId: string | null; // null only for platform Super Admin
  storeId: string | null;
  allStoresAccess?: boolean;
  isSuperAdmin: boolean;
  roles: string[]; // role names
  permissions: string[]; // permission codes, flattened
  impersonating?: boolean; // true when a Super Admin is using "Login as Store" (spec section 32)
  impersonatedBy?: string; // the Super Admin's own user id, for audit trails
}

export function signAuthToken(payload: AuthTokenPayload, expiresIn = JWT_EXPIRES_IN): string {
  const options: jwt.SignOptions = { expiresIn: expiresIn as jwt.SignOptions["expiresIn"] };
  return jwt.sign(payload, JWT_SECRET, options);
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  return jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
}
