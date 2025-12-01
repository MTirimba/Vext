"use client";

import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { MessageSquare } from "lucide-react";

interface MessageButtonProps {
  otherUserId: string;
  redirectToList?: boolean;
}

export default function MessageButton({
  otherUserId,
  redirectToList = false,
}: MessageButtonProps) {
  const router = useRouter();
  const auth = getAuth();
  const user = auth.currentUser;

  const handleClick = async () => {
    if (!user) {
      alert("You must be signed in to send a message.");
      return;
    }

    try {
      if (redirectToList) {
        router.push(`/messages?openWith=${otherUserId}`);
        return;
      }

      // Otherwise: ensure conversation exists
      const conversationsRef = collection(db, "conversations");
      const q = query(
        conversationsRef,
        where("participants", "array-contains", user.uid)
      );
      const querySnapshot = await getDocs(q);

      let conversationId: string | null = null;
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        if (
          Array.isArray(data.participants) &&
          data.participants.includes(otherUserId)
        ) {
          conversationId = doc.id;
        }
      });

      if (!conversationId) {
        const docRef = await addDoc(conversationsRef, {
          participants: [user.uid, otherUserId],
          createdAt: serverTimestamp(),
        });
        conversationId = docRef.id;
      }

      router.push(`/messages/${conversationId}`);
    } catch (error) {
      console.error("Error creating conversation:", error);
    }
  };

  return (
    <button
      onClick={handleClick}
      title="Message user"
      className="flex items-center justify-center w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200"
    >
      <MessageSquare className="w-5 h-5 text-gray-700" />
    </button>
  );
}