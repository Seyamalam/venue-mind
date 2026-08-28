import { createAuthenticatedIdentity } from "../src/domain/accounts.js";

export type AuthenticatedIdentity = ReturnType<typeof createAuthenticatedIdentity>;
export type IdentityProvider = { authenticate: (request: Request) => Promise<AuthenticatedIdentity | null> | AuthenticatedIdentity | null };

const decodeDisplayName = (request: Request) => {
  const value = request.headers.get("oai-authenticated-user-full-name");
  if (!value) return null;
  if (request.headers.get("oai-authenticated-user-full-name-encoding") !== "percent-encoded-utf-8") return null;
  try { return decodeURIComponent(value); } catch { return null; }
};

export function createSitesIdentityProvider(): IdentityProvider {
  return Object.freeze({
    authenticate(request) {
      const subject = request.headers.get("oai-authenticated-user-id")?.trim();
      const email = request.headers.get("oai-authenticated-user-email")?.trim();
      if (!subject || !email) return null;
      return createAuthenticatedIdentity({ provider: "openai-sites", subject, email, displayName: decodeDisplayName(request) });
    },
  });
}

export function createStaticIdentityProvider(identity: AuthenticatedIdentity | null): IdentityProvider {
  return Object.freeze({ authenticate: () => identity });
}
