import { createAuthenticatedIdentity } from "../src/domain/accounts.js";

export type AuthenticatedIdentity = ReturnType<typeof createAuthenticatedIdentity>;
export type IdentityProvider = { authenticate: (request: Request) => Promise<AuthenticatedIdentity | null> | AuthenticatedIdentity | null };

export function createStaticIdentityProvider(identity: AuthenticatedIdentity | null): IdentityProvider {
  return Object.freeze({ authenticate: () => identity });
}
