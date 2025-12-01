"use client";

import { Suspense, useEffect, useState } from "react";
import { useAuthState } from "react-firebase-hooks/auth";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import { db, auth } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  doc,
  getDoc,
  limit,
} from "firebase/firestore";
import Link from "next/link";

type Conversation = {
  id: string;
  participants: string[];
  createdAt?: any;
};

type UserProfile = {
  id: string;
  businessName?: string;
  displayName?: string;
  photoURL?: string;
};

type LastMessageData = {
  text: string;
  createdAt?: any;
  senderId?: string;
  readBy?: string[];
};

function formatTimestamp(ts: any): string {
  if (!ts) return "";
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 24 * 60 * 60 * 1000) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (diff < 48 * 60 * 60 * 1000) {
    return "Yesterday";
  } else {
    return date.toLocaleDateString();
  }
}

function MessagesList() {
  const [user] = useAuthState(auth);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [lastMessages, setLastMessages] = useState<
    Record<string, LastMessageData>
  >({});
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ conversationId?: string }>();

  const openWith = searchParams.get("openWith"); // redirect case
  const activeConversationId = params?.conversationId;

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, "conversations"),
      where("participants", "array-contains", user.uid),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(q, async (snap) => {
      const convs = snap.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<Conversation, "id">),
      }));
      setConversations(convs);

      // Fetch profiles for other participants
      const otherIds = convs
        .map((c) => c.participants.find((p) => p !== user.uid))
        .filter((id): id is string => !!id);

      const newProfiles: Record<string, UserProfile> = { ...profiles };

      for (const id of otherIds) {
        if (!newProfiles[id]) {
          const userRef = doc(db, "users", id);
          const snap = await getDoc(userRef);
          if (snap.exists()) {
            newProfiles[id] = { id, ...(snap.data() as any) };
          } else {
            newProfiles[id] = { id };
          }
        }
      }

      setProfiles(newProfiles);

      // Fetch last message for each conversation
      convs.forEach((conv) => {
        const messagesRef = collection(
          db,
          "conversations",
          conv.id,
          "messages"
        );
        const lastMsgQuery = query(
          messagesRef,
          orderBy("createdAt", "desc"),
          limit(1)
        );

        onSnapshot(lastMsgQuery, (msgSnap) => {
          if (!msgSnap.empty) {
            const lastMsg = msgSnap.docs[0].data() as LastMessageData;
            setLastMessages((prev) => ({
              ...prev,
              [conv.id]: lastMsg,
            }));
          }
        });
      });

      // ✅ Only redirect if explicitly opened with openWith
      if (convs.length > 0 && openWith && !activeConversationId) {
        const conv = convs.find((c) => c.participants.includes(openWith));
        if (conv) {
          router.replace(`/messages/${conv.id}`);
        }
      }
    });

    return () => unsub();
  }, [user, openWith, activeConversationId, router]);

  if (!user) {
    return <div className="p-4">Please sign in to view messages.</div>;
  }

  return (
    <div className="h-screen flex">
      {/* Sidebar (hidden on mobile if inside conversation) */}
      <div
        className={`w-full md:w-1/3 border-r overflow-y-auto
          ${activeConversationId ? "hidden md:block" : "block"}`}
      >
        <h2 className="p-4 font-bold text-lg border-b">Chats</h2>
        <ul>
          {conversations.map((conv) => {
            const otherId = conv.participants.find((p) => p !== user.uid);
            const otherProfile = otherId ? profiles[otherId] : null;
            const displayName =
              otherProfile?.businessName ||
              otherProfile?.displayName ||
              otherId;
            const photoURL = otherProfile?.photoURL || "/default-avatar.png";

            const lastMsgData = lastMessages[conv.id];
            const lastMsg = lastMsgData?.text || "No messages yet";
            const timestamp = lastMsgData?.createdAt
              ? formatTimestamp(lastMsgData.createdAt)
              : "";

            const isUnread =
              lastMsgData &&
              lastMsgData.senderId !== user.uid &&
              (!lastMsgData.readBy ||
                !lastMsgData.readBy.includes(user.uid));

            return (
              <li key={conv.id}>
                <Link
                  href={`/messages/${conv.id}`}
                  className={`flex items-center gap-3 p-4 hover:bg-gray-100 ${
                    conv.id === activeConversationId ? "bg-gray-200" : ""
                  }`}
                >
                  <img
                    src={photoURL}
                    alt={displayName}
                    className="w-10 h-10 rounded-full object-cover"
                  />
                  <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="flex justify-between items-center">
                      <span
                        className={`truncate ${
                          isUnread ? "font-bold" : "font-medium"
                        }`}
                      >
                        {displayName}
                      </span>
                      {timestamp && (
                        <span className="text-xs text-gray-500 ml-2">
                          {timestamp}
                        </span>
                      )}
                    </div>
                    <span
                      className={`truncate text-sm ${
                        isUnread ? "font-bold text-black" : "text-gray-500"
                      }`}
                    >
                      {lastMsg}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Conversation Pane (hidden on mobile when no conversation selected) */}
      <div
        className={`flex-1 ${
          !activeConversationId ? "hidden md:flex" : "flex"
        }`}
      >
        {activeConversationId ? (
          <iframe
            src={`/messages/${activeConversationId}`}
            className="w-full h-full border-0"
          />
        ) : (
          <div className="flex items-center justify-center flex-1">
            <p className="text-gray-500">
              Select a conversation to start chatting
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="p-4">Loading conversations…</div>}>
      <MessagesList />
    </Suspense>
  );
}