import { NOTIFICATION_EVENT_TYPES, safeNotification } from "../src/domain/sharing.ts";
import type { NotificationEventType, NotificationRefs } from "../src/domain/sharing.ts";

interface ClaimedEmail {
  readonly id: string;
  readonly notificationId: string;
  readonly recipientEmail: string;
  readonly bodyCode: string;
  readonly refs: NotificationRefs;
  readonly createdAt: string;
}

interface EmailRepository {
  claimEmailBatch(input: {
    readonly organizationId: string | null;
    readonly now: string;
    readonly leaseExpiresAt: string;
    readonly leaseToken: string;
    readonly limit: number;
  }): Promise<readonly ClaimedEmail[]>;
  markEmailDelivered(id: string, leaseToken: string, deliveredAt: string): Promise<void>;
  markEmailFailed(id: string, leaseToken: string, failureCode: string, attemptedAt: string): Promise<void>;
}

interface EmailDeliveryProvider {
  send(input: {
    readonly idempotencyKey: string;
    readonly to: string;
    readonly bodyCode: string;
    readonly refs: NotificationRefs;
  }): Promise<{ readonly delivered: boolean }>;
}

interface DrainEmailOptions {
  readonly repository: EmailRepository;
  readonly delivery: EmailDeliveryProvider | null | undefined;
  readonly organizationId?: string | null;
  readonly clock?: () => string;
  readonly limit?: number;
}

const isNotificationEventType = (value: string): value is NotificationEventType =>
  NOTIFICATION_EVENT_TYPES.some((eventType) => eventType === value);

const failureCode = (cause: unknown) => {
  const coded =
    cause && typeof cause === "object" && "code" in cause
      ? String(cause.code)
      : cause instanceof Error
        ? cause.message
        : "";
  return /^[A-Z][A-Z0-9_]{2,79}$/.test(coded) ? coded : "EMAIL_DELIVERY_FAILED";
};

export async function drainNotificationEmail({
  repository,
  delivery,
  organizationId = null,
  clock = () => new Date().toISOString(),
  limit = 25,
}: DrainEmailOptions) {
  if (!delivery) return { status: "provider-unavailable", claimed: 0, delivered: 0, failed: 0 };
  const now = clock();
  const leaseToken = `email-lease-${crypto.randomUUID()}`;
  const leaseExpiresAt = new Date(Date.parse(now) + 60_000).toISOString();
  const claimed = await repository.claimEmailBatch({ organizationId, now, leaseExpiresAt, leaseToken, limit });
  let delivered = 0;
  let failed = 0;
  for (const item of claimed) {
    try {
      const eventType = item.bodyCode.startsWith("notification.") ? item.bodyCode.slice("notification.".length) : "";
      if (!isNotificationEventType(eventType)) throw new Error("NOTIFICATION_EVENT_INVALID");
      safeNotification({
        id: item.notificationId,
        organizationId: "delivery",
        projectId: "delivery",
        userId: "delivery",
        eventType,
        refs: item.refs,
        createdAt: item.createdAt,
      });
      const receipt = await delivery.send({
        idempotencyKey: item.id,
        to: item.recipientEmail,
        bodyCode: item.bodyCode,
        refs: structuredClone(item.refs),
      });
      if (!receipt.delivered) throw new Error("EMAIL_PROVIDER_UNCONFIRMED");
      await repository.markEmailDelivered(item.id, leaseToken, clock());
      delivered += 1;
    } catch (cause) {
      await repository.markEmailFailed(item.id, leaseToken, failureCode(cause), clock());
      failed += 1;
    }
  }
  return { status: "drained", claimed: claimed.length, delivered, failed };
}
