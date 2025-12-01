'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { useParams } from 'next/navigation';
import {
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  doc,
  updateDoc,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';

type Message = {
  id: string;
  text: string;
  sender: string;
  createdAt?: any;
  read?: boolean;
};

export default function ConversationPage() {
  const [user] = useAuthState(auth);
  const params = useParams<{ conversationId: string }>();
  const conversationId = params.conversationId;

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conversationId) return;

    const q = query(
      collection(db, 'conversations', conversationId, 'messages'),
      orderBy('createdAt', 'asc')
    );

    const unsub = onSnapshot(q, async (snap) => {
      const msgs = snap.docs.map(
        (doc) => ({ id: doc.id, ...(doc.data() as Omit<Message, 'id'>) }) as Message
      );
      setMessages(msgs);

      // ✅ Mark all unread messages (not sent by me) as read when viewing conversation
      if (user) {
        const batch = writeBatch(db);
        msgs.forEach((m) => {
          if (m.sender !== user.uid && !m.read) {
            const msgRef = doc(db, 'conversations', conversationId, 'messages', m.id);
            batch.update(msgRef, { read: true });
          }
        });
        if (!batch._mutations?.length) return; // only commit if there are updates
        await batch.commit();
      }
    });

    return () => unsub();
  }, [conversationId, user]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !user) return;
    await addDoc(collection(db, 'conversations', conversationId, 'messages'), {
      text: newMessage,
      sender: user.uid,
      createdAt: serverTimestamp(),
      read: false,
    });
    setNewMessage('');
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!user) {
    return <div className="p-4">Please sign in to view this conversation.</div>;
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-gray-50">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.sender === user.uid ? 'justify-end' : 'justify-start'}`}
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
                {msg.createdAt?.toDate
                  ? msg.createdAt.toDate().toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : ''}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input box */}
      <div className="p-4 border-t flex items-center gap-2">
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