"use client";

import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { useAuthState } from "react-firebase-hooks/auth";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
} from "firebase/firestore";

interface Withdrawal {
  id: string;
  amount: number;
  fee?: number;
  net?: number;
  method: string;
  phone?: string;
  status: string;
  receipt?: string;
  completionTime?: string;
  createdAt?: { seconds: number; nanoseconds: number };
  updatedAt?: { seconds: number; nanoseconds: number };
}

export default function WithdrawalHistory() {
  const [user] = useAuthState(auth);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const ref = collection(db, "users", user.uid, "withdrawals");
    const q = query(ref, orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: Withdrawal[] = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Withdrawal),
      }));
      setWithdrawals(list);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  if (!user) return <p className="p-6">Please log in to view withdrawals.</p>;
  if (loading) return <p className="p-6">Loading withdrawal history…</p>;

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case "completed":
      case "success":
        return "bg-green-100 text-green-700 border-green-400";
      case "processing":
      case "pending":
        return "bg-yellow-100 text-yellow-700 border-yellow-400";
      case "failed":
      case "error":
        return "bg-red-100 text-red-700 border-red-400";
      default:
        return "bg-gray-100 text-gray-700 border-gray-400";
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-md mt-6">
      <h2 className="text-xl font-bold mb-4">Withdrawal History</h2>

      {withdrawals.length === 0 ? (
        <p>No withdrawals yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border border-gray-200 text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="py-2 px-3 text-left border-b">Date</th>
                <th className="py-2 px-3 text-left border-b">Amount</th>
                <th className="py-2 px-3 text-left border-b">Method</th>
                <th className="py-2 px-3 text-left border-b">Phone</th>
                <th className="py-2 px-3 text-left border-b">Status</th>
                <th className="py-2 px-3 text-left border-b">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {withdrawals.map((w) => (
                <tr key={w.id} className="border-b hover:bg-gray-50">
                  <td className="py-2 px-3">
                    {w.createdAt
                      ? new Date(w.createdAt.seconds * 1000).toLocaleString()
                      : "—"}
                  </td>
                  <td className="py-2 px-3 font-semibold">
                    KES {w.amount?.toFixed(2) || "0.00"}
                  </td>
                  <td className="py-2 px-3">{w.method || "—"}</td>
                  <td className="py-2 px-3">{w.phone || "—"}</td>
                  <td className="py-2 px-3">
                    <span
                      className={`px-2 py-1 rounded-full border text-xs font-semibold ${getStatusColor(
                        w.status
                      )}`}
                    >
                      {w.status?.charAt(0).toUpperCase() +
                        w.status?.slice(1)}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-gray-600 text-xs">
                    {w.receipt || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}