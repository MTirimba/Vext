// /workspaces/Vext/hooks/useTutorialFlag.ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type TutorialTrackId = "visitor" | "provider";

const FIRESTORE_FIELD: Record<TutorialTrackId, string> = {
  visitor: "hasSeenVisitorTutorial",
  provider: "hasSeenProviderTutorial",
};

function localStorageKey(track: TutorialTrackId) {
  return `vext_tutorial_${track}_seen`;
}

/**
 * Tracks whether a given tutorial track has been seen, and exposes a way to
 * mark it seen (dismiss/complete) or force it to show again (replay).
 *
 * - Signed-out visitors have no Firestore user doc yet, so localStorage is
 *   the only place to remember "seen" for them.
 * - Signed-in users get it written to their own /users/{uid} doc instead —
 *   same pattern as other profile flags (offersMobileService, etc.) — so it
 *   follows them across devices. localStorage is still checked too, so a
 *   flag set while signed out still counts once they sign in.
 */
export function useTutorialFlag(track: TutorialTrackId, uid: string | null) {
  const [loading, setLoading] = useState(true);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      const localSeen =
        typeof window !== "undefined" &&
        window.localStorage.getItem(localStorageKey(track)) === "1";

      let remoteSeen = false;
      if (uid) {
        try {
          const snap = await getDoc(doc(db, "users", uid));
          remoteSeen = !!snap.exists() && !!(snap.data() as any)?.[FIRESTORE_FIELD[track]];
        } catch (err) {
          console.error("useTutorialFlag: failed to read user doc", err);
        }
      }

      if (!cancelled) {
        setSeen(localSeen || remoteSeen);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [track, uid]);

  const markSeen = useCallback(async () => {
    setSeen(true);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(localStorageKey(track), "1");
    }
    if (uid) {
      try {
        await setDoc(
          doc(db, "users", uid),
          { [FIRESTORE_FIELD[track]]: true },
          { merge: true },
        );
      } catch (err) {
        console.error("useTutorialFlag: failed to save user doc", err);
      }
    }
  }, [track, uid]);

  // Used by the "Replay tutorial" action on the profile page — clears the
  // seen flag so the tutorial auto-shows again next time its host page
  // (the feed, or the provider's own profile) loads.
  const resetSeen = useCallback(async () => {
    setSeen(false);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(localStorageKey(track));
    }
    if (uid) {
      try {
        await setDoc(
          doc(db, "users", uid),
          { [FIRESTORE_FIELD[track]]: false },
          { merge: true },
        );
      } catch (err) {
        console.error("useTutorialFlag: failed to reset user doc", err);
      }
    }
  }, [track, uid]);

  // Replay never needs to persist anything until the user finishes/skips it
  // again — markSeen() at the end of that run handles that the same way.
  const [replayToken, setReplayToken] = useState(0);
  const replay = useCallback(() => setReplayToken((n) => n + 1), []);

  return { loading, seen, markSeen, resetSeen, replay, replayToken };
}