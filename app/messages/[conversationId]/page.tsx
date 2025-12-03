'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { useParams, useRouter } from 'next/navigation';
import {
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  doc,
  writeBatch,
  getDoc,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';

type Message = {
  id: string;
  text: string;
  sender: string;
  createdAt?: any;
  read?: boolean;
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

export default function ConversationPage() {
  const [user] = useAuthState(auth);
  const router = useRouter();
  const params = useParams<{ conversationId: string }>();
  const conversationId = params.conversationId;

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const [otherUser, setOtherUser] = useState<UserProfile | null>(null);

  // Fetch other participant's profile for header
  useEffect(() => {
    if (!conversationId || !user) return;

    (async () => {
      try {
        const convSnap = await getDoc(doc(db, 'conversations', conversationId));
        if (!convSnap.exists()) return;
        const convData = convSnap.data() as { participants?: string[] };
        const participants = convData.participants || [];
        const otherId =
          participants.find((p) => p !== user.uid) || participants[0];
        if (!otherId) return;

        const userSnap = await getDoc(doc(db, 'users', otherId));
        if (userSnap.exists()) {
          setOtherUser({ id: otherId, ...(userSnap.data() as any) });
        } else {
          setOtherUser({ id: otherId });
        }
      } catch (err) {
        console.error('conversation header fetch error', err);
      }
    })();
  }, [conversationId, user]);

  // Subscribe to messages + mark read
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

      // Mark unread messages (not mine) as read
      if (user) {
        const batch = writeBatch(db);
        let hasUpdates = false;

        msgs.forEach((m) => {
          if (m.sender !== user.uid && !m.read) {
            const msgRef = doc(
              db,
              'conversations',
              conversationId,
              'messages',
              m.id,
            );
            batch.update(msgRef, { read: true });
            hasUpdates = true;
          }
        });

        if (hasUpdates) {
          try {
            await batch.commit();
          } catch (err) {
            console.error('mark messages read error', err);
          }
        }
      }
    });

    return () => unsub();
  }, [conversationId, user]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !user) return;
    try {
      await addDoc(
        collection(db, 'conversations', conversationId, 'messages'),
        {
          text: newMessage.trim(),
          sender: user.uid,
          createdAt: serverTimestamp(),
          read: false,
        },
      );
      setNewMessage('');
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      console.error('sendMessage error', err);
    }
  };

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!user) {
    return <div className="p-4">Please sign in to view this conversation.</div>;
  }

  const avatarUrl =
    otherUser?.businessProfilePhoto ||
    otherUser?.profilePhoto ||
    otherUser?.photoURL ||
    '/default-avatar.png';

  const displayName =
    otherUser?.businessName ||
    otherUser?.fullName ||
    otherUser?.displayName ||
    otherUser?.id ||
    'Chat';

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header with avatar + name */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-white">
        {/* Back only visible on small screens */}
        <button
          type="button"
          onClick={() => router.back()}
          className="md:hidden text-gray-600 hover:text-black mr-1"
        >
          ←
        </button>
        <img
          src={avatarUrl}
          alt={displayName}
          className="w-8 h-8 rounded-full object-cover"
        />
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-gray-900">
            {displayName}
          </span>
          {otherUser?.businessName && otherUser?.fullName && (
            <span className="text-[11px] text-gray-500">
              {otherUser.fullName}
            </span>
          )}
        </div>
      </div>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-gray-50">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${
              msg.sender === user.uid ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`px-4 py-2 rounded-2xl max-w-xs break-words shadow-sm ${
                msg.sender === user.uid
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

      {/* Input box */}
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