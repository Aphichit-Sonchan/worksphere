"use client";

import {
  ArrowRightLeft,
  AtSign,
  Bell,
  CheckCheck,
  MailPlus,
  UserCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useNotifications, type NotificationDto } from "@/hooks/use-realtime";
import { useRouter } from "@/i18n/navigation";

function NotificationIcon({ type }: { type: NotificationDto["type"] }) {
  if (type === "TASK_ASSIGNED") {
    return (
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
        <UserCheck className="h-4 w-4" />
      </span>
    );
  }
  if (type === "MENTIONED") {
    return (
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
        <AtSign className="h-4 w-4" />
      </span>
    );
  }
  if (type === "INVITED") {
    return (
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
        <MailPlus className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
      <ArrowRightLeft className="h-4 w-4" />
    </span>
  );
}

export default function NotificationsPage() {
  const t = useTranslations("Realtime");
  const router = useRouter();
  const [unreadOnly, setUnreadOnly] = useState(false);

  const { notifications, unreadCount, isLoading, markRead, markAllRead } = useNotifications(
    true,
    unreadOnly,
  );

  async function handleOpenNotification(item: NotificationDto) {
    if (!item.readAt) {
      await markRead(item.id);
    }
    if (item.linkUrl) {
      router.push(item.linkUrl);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {t("notificationsTitle")}
            </h1>
            {unreadCount > 0 && <Badge variant="info">{unreadCount}</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-500">{t("notificationsDesc")}</p>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setUnreadOnly(false)}
              className={`cursor-pointer rounded-lg px-3 py-1.5 transition ${
                !unreadOnly ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t("filterAll")}
            </button>
            <button
              type="button"
              onClick={() => setUnreadOnly(true)}
              className={`cursor-pointer rounded-lg px-3 py-1.5 transition ${
                unreadOnly ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t("filterUnread")}
            </button>
          </div>

          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={() => markAllRead()}>
              <CheckCheck className="h-4 w-4" />
              {t("markAllRead")}
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <Card className="py-14 text-center">
          <Bell className="mx-auto h-10 w-10 text-slate-300" />
          <h3 className="mt-3 text-base font-semibold text-slate-900">{t("emptyNotifications")}</h3>
          <p className="mt-1 text-sm text-slate-500">{t("emptyNotificationsHint")}</p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-slate-100">
            {notifications.map((item) => {
              const isUnread = !item.readAt;
              return (
                <div
                  key={item.id}
                  onClick={() => handleOpenNotification(item)}
                  className={`flex cursor-pointer items-center justify-between gap-4 px-5 py-4 transition hover:bg-slate-50 ${
                    isUnread ? "bg-blue-50/35" : "bg-white"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3.5">
                    <NotificationIcon type={item.type} />
                    <div className="min-w-0">
                      <p
                        className={`truncate text-sm ${
                          isUnread ? "font-semibold text-slate-900" : "font-medium text-slate-700"
                        }`}
                      >
                        {item.title}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {isUnread && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-600" />}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
