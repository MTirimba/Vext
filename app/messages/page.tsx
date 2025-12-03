'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { useRouter, useSearchParams } from 'next/navigation';
import { db, auth } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  doc,
  getDoc,
  limit,
  addDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import Link from 'next/link';

type Conversation = {
  id: string;
  participants: string[];
  createdAt?: any;
};

type UserProfile = {
  id: string;
  businessName?: string;
  fullName?: string;
  displayName?: string;
  profilePhoto?: string;
  businessProfilePhoto?: string;
  photoURL?: string;
  isProvider?: boolean;
};

type LastMessageData = {
  text: string;
  createdAt?: any;
  sender?: string;
  senderId?: string;
  read?: boolean;
  readBy?: string[];
};

type Message = {
  id: string;
  text: string;
  sender: string;
  createdAt?: any;
  read?: boolean;
};

function formatTimestamp(ts: any): string {
  if (!ts) return '';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 24 * 60 * 60 * 1000) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diff < 48 * 60 * 60 * 1000) {
    return 'Yesterday';
  } else {
    return date.toLocaleDateString();
  }
}

function formatMessageTimestamp(ts: any): string {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();

  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const timeStr = d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (sameDay) return timeStr;

  const dateStr = d.toLocaleDateString();
  return `${timeStr} · ${dateStr}`;
}

/**
 * Right-hand chat pane used on /messages for the active conversation.
 * Very similar to /messages/[conversationId]/page.tsx but embedded.
 */
function ConversationPane({
  conversationId,
  currentUserId,
  otherProfile,
}: {
  conversationId: string;
  currentUserId: string;
  otherProfile: UserProfile | null;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conversationId) return;

    const q = query(
      collection(db, 'conversations', conversationId, 'messages'),
      orderBy('createdAt', 'asc'),
    );

    const unsub = onSnapshot(q, async (snap) => {
      const msgs = snap.docs.map(
        (d) => ({ id: d.id, ...(d.data() as Omit<Message, 'id'>) }) as Message,
      );
      setMessages(msgs);

      // mark unread as read
      const batch = writeBatch(db);
      let hasUpdates = false;
      msgs.forEach((m) => {
        if (m.sender !== currentUserId && !m.read) {
          batch.update(
            doc(db, 'conversations', conversationId, 'messages', m.id),
            { read: true },
          );
          hasUpdates = true;
        }
      });
      if (hasUpdates) {
        try {
          await batch.commit();
        } catch (err) {
          console.error('mark read error', err);
        }
      }
    });

    return () => unsub();
  }, [conversationId, currentUserId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !currentUserId) return;
    try {
      await addDoc(
        collection(db, 'conversations', conversationId, 'messages'),
        {
          text: newMessage.trim(),
          sender: currentUserId,
          createdAt: serverTimestamp(),
          read: false,
        },
      );
      setNewMessage('');
    } catch (err) {
      console.error('sendMessage error', err);
    }
  };

  const avatarUrl =
    otherProfile?.businessProfilePhoto ||
    otherProfile?.profilePhoto ||
    otherProfile?.photoURL ||
    '/default-avatar.png';

  const displayName =
    otherProfile?.businessName ||
    otherProfile?.fullName ||
    otherProfile?.displayName ||
    otherProfile?.id ||
    'Chat';

  return (
    <div className="flex flex-col h-full w-full bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-white">
        <img
          src={avatarUrl}
          alt={displayName}
          className="w-8 h-8 rounded-full object-cover"
        />
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-gray-900">
            {displayName}
          </span>
          {otherProfile?.businessName && otherProfile?.fullName && (
            <span className="text-[11px] text-gray-500">
              {otherProfile.fullName}
            </span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-gray-50">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${
              msg.sender === currentUserId ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`px-4 py-2 rounded-2xl max-w-xs break-words shadow-sm ${
                msg.sender === currentUserId
                  ? 'bg-blue-500 text-white rounded-br-none'
                  : 'bg-gray-200 text-gray-900 rounded-bl-none'
              }`}
            >
              {msg.text}
              <div className="text-[10px] mt-1 opacity-70 text-right">
                {formatMessageTimestamp(msg.createdAt)}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t flex items-center gap-2 bg-white">
        <input
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Type a message..."
          className="flex-1 border rounded-full px-4 py-2 focus:outline-none focus:ring"
        />
        <button
          onClick={sendMessage}
          className="bg-blue-500 text-white px-4 py-2 rounded-full hover:bg-blue-600"
        >
          Send
        </button>
      </div>
    </div>
  );
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

  const openWith = searchParams.get('openWith'); // redirect case
  const activeConversationId = searchParams.get('conversationId');

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'conversations'),
      where('participants', 'array-contains', user.uid),
      orderBy('createdAt', 'desc'),
    );

    const unsub = onSnapshot(q, async (snap) => {
      const convs = snap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Conversation, 'id'>),
      }));
      setConversations(convs);

      // Fetch profiles for other participants
      const otherIds = convs
        .map((c) => c.participants.find((p) => p !== user.uid))
        .filter((id): id is string => !!id);

      const newProfiles: Record<string, UserProfile> = { ...profiles };

      for (const id of otherIds) {
        if (!newProfiles[id]) {
          const userRef = doc(db, 'users', id);
          const snapUser = await getDoc(userRef);
          if (snapUser.exists()) {
            newProfiles[id] = { id, ...(snapUser.data() as any) };
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
          'conversations',
          conv.id,
          'messages',
        );
        const lastMsgQuery = query(
          messagesRef,
          orderBy('createdAt', 'desc'),
          limit(1),
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

      // Redirect if openWith param present and no active conversation
      if (convs.length > 0 && openWith && !activeConversationId) {
        const conv = convs.find((c) => c.participants.includes(openWith));
        if (conv) {
          router.replace(`/messages?conversationId=${conv.id}`);
        }
      }
    });

    return () => unsub();
  }, [user, openWith, activeConversationId, router]);

  if (!user) {
    return <div className="p-4">Please sign in to view messages.</div>;
  }

  const activeConversation = activeConversationId
    ? conversations.find((c) => c.id === activeConversationId) || null
    : null;
  const otherId =
    activeConversation?.participants.find((p) => p !== user.uid) || null;
  const activeProfile = otherId ? profiles[otherId] || null : null;

  return (
    <div className="h-screen flex">
      {/* Sidebar (hidden on mobile if a conversation is open) */}
      <div
        className={`w-full md:w-1/3 border-r overflow-y-auto ${
          activeConversationId ? 'hidden md:block' : 'block'
        }`}
      >
        <h2 className="p-4 font-bold text-lg border-b">Chats</h2>
        <ul>
          {conversations.map((conv) => {
            const otherUserId = conv.participants.find(
              (p) => p !== user.uid,
            );
            const otherProfile = otherUserId ? profiles[otherUserId] : null;
            const displayName =
              otherProfile?.businessName ||
              otherProfile?.fullName ||
              otherProfile?.displayName ||
              otherUserId;
            const avatarUrl =
              otherProfile?.businessProfilePhoto ||
              otherProfile?.profilePhoto ||
              otherProfile?.photoURL ||
              '/default-avatar.png';

            const lastMsgData = lastMessages[conv.id];
            const lastMsg = lastMsgData?.text || 'No messages yet';
            const timestamp = lastMsgData?.createdAt
              ? formatTimestamp(lastMsgData.createdAt)
              : '';

            const senderId =
              lastMsgData?.senderId || lastMsgData?.sender || '';
            const isUnread =
              !!lastMsgData &&
              senderId !== user.uid &&
              (typeof lastMsgData.read === 'boolean'
                ? !lastMsgData.read
                : !lastMsgData.readBy ||
                  !lastMsgData.readBy.includes(user.uid));

            const isActive = conv.id === activeConversationId;

            return (
              <li key={conv.id}>
                <Link
                  href={`/messages?conversationId=${conv.id}`}
                  className={`flex items-center gap-3 p-4 hover:bg-gray-100 ${
                    isActive ? 'bg-gray-200' : ''
                  }`}
                >
                  <img
                    src={avatarUrl}
                    alt={displayName || 'User'}
                    className="w-10 h-10 rounded-full object-cover"
                  />
                  <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="flex justify-between items-center">
                      <span
                        className={`truncate ${
                          isUnread ? 'font-bold' : 'font-medium'
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
                        isUnread ? 'font-bold text-black' : 'text-gray-500'
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

      {/* Conversation Pane (full-width on mobile when active) */}
      <div
        className={`flex-1 ${
          !activeConversationId ? 'hidden md:flex' : 'flex'
        }`}
      >
        {activeConversationId && activeConversation ? (
          <ConversationPane
            conversationId={activeConversationId}
            currentUserId={user.uid}
            otherProfile={activeProfile}
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