import type { NotificationOutboxRecord } from "./types";

export type NotificationDispatchResult = {
  deliveredAt: string;
  providerMessageId: string;
};

export interface NotificationDispatcher {
  readonly provider: string;
  deliver(notification: NotificationOutboxRecord): Promise<NotificationDispatchResult>;
}

export type NotificationDispatcherLifecycle = {
  claimPending(limit: number): Promise<NotificationOutboxRecord[]>;
  markDeadLetter(notificationId: string, errorMessage: string): Promise<void>;
  markDelivered(notificationId: string, result: NotificationDispatchResult): Promise<void>;
  markFailed(notificationId: string, errorMessage: string): Promise<void>;
};
