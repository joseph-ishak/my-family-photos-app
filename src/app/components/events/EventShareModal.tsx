// src/app/components/events/EventShareModal.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type GroupSummary = {
  groupId: string;
  name: string;
  role: "owner" | "admin" | "member";
  createdAt: string | null;
};

type ShareRecord = {
  groupId: string;
  groupName?: string;
  createdAt?: string | null;
};

async function readJsonSafe(res: Response) {
  return (await res.json().catch(() => ({}))) as any;
}

function roleAllowsShare(role: GroupSummary["role"]) {
  return role === "owner" || role === "admin";
}

export default function EventShareModal(props: {
  open: boolean;
  eventId: string;
  onClose: () => void;
}) {
  const { open, eventId, onClose } = props;

  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [working, setWorking] = useState(false);

  const eligibleGroups = useMemo(
    () => groups.filter((g) => roleAllowsShare(g.role)),
    [groups]
  );

  const sharedGroupIds = useMemo(() => {
    return new Set(shares.map((s) => s.groupId));
  }, [shares]);

  const canShare = useMemo(() => {
    const gid = selectedGroupId.trim();
    if (working) return false;
    if (!gid) return false;
    if (sharedGroupIds.has(gid)) return false;
    return true;
  }, [working, selectedGroupId, sharedGroupIds]);

  const load = useCallback(async () => {
    if (!eventId) return;

    setLoading(true);
    try {
      const gRes = await fetch("/api/groups", { credentials: "include" });
      const gData = (await gRes.json().catch(() => ({}))) as any;
      const groupList = Array.isArray(gData?.groups) ? gData.groups : [];

      const sRes = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/share`,
        {
          credentials: "include",
        }
      );
      const sData = (await sRes.json().catch(() => ({}))) as any;
      const shareList = Array.isArray(sData?.shares) ? sData.shares : [];

      setGroups(groupList);
      setShares(shareList);
      setSelectedGroupId("");
    } catch (e) {
      console.error(e);
      setGroups([]);
      setShares([]);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (!open) return;
    if (!eventId) return;

    let cancelled = false;

    (async () => {
      if (cancelled) return;
      await load();
    })();

    return () => {
      cancelled = true;
    };
  }, [open, eventId, load]);

  const shareToGroup = async () => {
    const groupId = selectedGroupId.trim();
    if (!groupId) return;

    setWorking(true);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/share`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ groupId }),
        }
      );

      if (!res.ok) {
        const d = await readJsonSafe(res);
        alert(d?.error ? String(d.error) : "Share failed");
        return;
      }

      await load();
    } catch (e) {
      console.error(e);
      alert("Share failed");
    } finally {
      setWorking(false);
    }
  };

  const revokeShare = async (groupId: string) => {
    const gid = groupId.trim();
    if (!gid) return;

    setWorking(true);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(
          eventId
        )}/share?groupId=${encodeURIComponent(gid)}`,
        {
          method: "DELETE",
          credentials: "include",
        }
      );

      if (!res.ok) {
        const d = await readJsonSafe(res);
        alert(d?.error ? String(d.error) : "Revoke failed");
        return;
      }

      await load();
    } catch (e) {
      console.error(e);
      alert("Revoke failed");
    } finally {
      setWorking(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3">
      <div className="w-[94vw] max-w-2xl overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950 text-neutral-100 shadow-2xl">
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xl font-semibold tracking-tight">Share</div>
              <div className="mt-1 text-sm text-neutral-400">
                Share this event with a group.
              </div>
              <div className="mt-2 text-xs text-neutral-500 truncate">
                Event: {eventId}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={working}
              className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900 transition disabled:opacity-60"
            >
              Close
            </button>
          </div>
        </div>

        <div className="px-6 pb-6 space-y-5">
          <div className="rounded-2xl border border-white/10 bg-neutral-950/40 p-5">
            <div className="text-sm font-semibold text-white/90">
              Add group access
            </div>
            <div className="mt-1 text-xs text-white/60">
              Only groups where you are owner or admin can be used here.
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="space-y-2">
                <div className="text-sm font-medium text-neutral-200">
                  Group
                </div>

                <select
                  value={selectedGroupId}
                  onChange={(e) => setSelectedGroupId(e.target.value)}
                  disabled={loading || working}
                  className="w-full rounded-2xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm text-neutral-100 outline-none focus:border-neutral-600"
                >
                  <option value="">Select group</option>
                  {eligibleGroups.map((g) => (
                    <option key={g.groupId} value={g.groupId}>
                      {g.name}
                    </option>
                  ))}
                </select>

                {loading ? (
                  <div className="text-xs text-neutral-500">Loading…</div>
                ) : null}
              </div>

              <button
                onClick={shareToGroup}
                disabled={!canShare}
                className="rounded-2xl bg-neutral-50 px-6 py-3 text-sm font-medium text-neutral-900 hover:opacity-90 transition disabled:opacity-50"
              >
                {working ? "Working" : "Share"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-neutral-950/40 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-white/90">
                Shared with
              </div>
              <div className="text-xs text-white/60">{shares.length} total</div>
            </div>

            {shares.length === 0 ? (
              <div className="mt-4 text-sm text-neutral-500">
                Not shared yet.
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {shares.map((s) => (
                  <div
                    key={s.groupId}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-neutral-950/60 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm text-white/90">
                        {s.groupName || s.groupId}
                      </div>
                      <div className="mt-1 text-[11px] text-white/60 truncate">
                        {s.groupId}
                      </div>
                    </div>

                    <button
                      onClick={() => revokeShare(s.groupId)}
                      disabled={working}
                      className="shrink-0 rounded-xl border border-white/10 bg-neutral-950/40 px-3 py-2 text-sm text-white/80 hover:bg-neutral-900/40 transition disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="text-xs text-neutral-500">
            Next we can add invite by email and show member names instead of
            ids.
          </div>
        </div>
      </div>
    </div>
  );
}
