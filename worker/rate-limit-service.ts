import {
  VENUE_RATE_LIMITS,
  VENUE_RATE_LIMIT_WINDOW_SECONDS,
  type VenueRateEndpointFamily,
} from "../src/security/resource-limits.ts";
import type { RateLimitRepository, RateLimitScopeType } from "./rate-limit-repository.ts";

export interface RateLimitRequest {
  readonly sessionId: string;
  readonly organizationId: string | null;
  readonly endpointFamily: VenueRateEndpointFamily;
}
export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly endpointFamily: VenueRateEndpointFamily;
  readonly limitedScope: RateLimitScopeType | null;
  readonly retryAfterSeconds: number;
}

const encoder = new TextEncoder();
const hex = (value: ArrayBuffer): string =>
  [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
export const opaqueRateLimitScope = async (scopeType: RateLimitScopeType, scopeId: string): Promise<string> => {
  if (!scopeId.trim()) throw new TypeError("Rate-limit scope ID is required");
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(`venuemind-rate-limit\u0000${scopeType}\u0000${scopeId}`)));
};

export const mutationEndpointFamily = (method: string, pathname: string): VenueRateEndpointFamily | null => {
  if (!new Set(["POST", "PUT", "PATCH", "DELETE"]).has(method.toUpperCase())) return null;
  if (/^\/api\/(?:adapters|webhooks)(?:\/|$)/.test(pathname)) return "adapter-webhook-mutation";
  if (/^\/api\/projects\/[^/]+\/(?:runbooks|occupancy-monitors|incident-registers|deviation-registers)(?:\/|$)/.test(pathname))
    return "operational-command-sync";
  if (/^\/api\/projects\/[^/]+\/share-links(?:\/|$)/.test(pathname)) return "sharing-membership-mutations";
  if (
    /^\/api\/(?:session\/revoke|organizations|invitations(?:\/accept)?|memberships(?:\/[^/]+)?|account|notification-preferences|notifications(?:\/[^/]+\/read|\/email\/drain)?)$/.test(
      pathname,
    )
  )
    return "sharing-membership-mutations";
  if (/^\/api\/projects\/[^/]+(?:\/collaboration\/presence)?$/.test(pathname)) return "project-writes";
  return null;
};

export function createRateLimitService({
  repository,
  clock = () => new Date().toISOString(),
}: {
  readonly repository: RateLimitRepository;
  readonly clock?: () => string;
}) {
  return Object.freeze({
    async consume(input: RateLimitRequest): Promise<RateLimitDecision> {
      const instant = Date.parse(clock());
      if (!Number.isFinite(instant)) throw new TypeError("Rate-limit clock is invalid");
      const windowMs = VENUE_RATE_LIMIT_WINDOW_SECONDS * 1_000;
      const windowStartedAt = Math.floor(instant / windowMs) * windowMs;
      const expiresAt = windowStartedAt + windowMs;
      const retryAfterSeconds = Math.max(
        1,
        Math.min(VENUE_RATE_LIMIT_WINDOW_SECONDS, Math.ceil((expiresAt - instant) / 1_000)),
      );
      const budget = VENUE_RATE_LIMITS[input.endpointFamily];
      const scopes: ReadonlyArray<Readonly<{ scopeType: RateLimitScopeType; scopeId: string; maximum: number }>> = [
        { scopeType: "identity", scopeId: input.sessionId, maximum: budget.identity },
        ...(input.organizationId
          ? [{ scopeType: "organization" as const, scopeId: input.organizationId, maximum: budget.organization }]
          : []),
      ];
      for (const scope of scopes) {
        const result = await repository.consume({
          scopeType: scope.scopeType,
          scopeHash: await opaqueRateLimitScope(scope.scopeType, scope.scopeId),
          endpointFamily: input.endpointFamily,
          windowStartedAt,
          expiresAt,
          maximum: scope.maximum,
        });
        if (!result.allowed)
          return Object.freeze({
            allowed: false,
            endpointFamily: input.endpointFamily,
            limitedScope: scope.scopeType,
            retryAfterSeconds,
          });
      }
      return Object.freeze({
        allowed: true,
        endpointFamily: input.endpointFamily,
        limitedScope: null,
        retryAfterSeconds: 0,
      });
    },
  });
}

export type RateLimitService = ReturnType<typeof createRateLimitService>;
