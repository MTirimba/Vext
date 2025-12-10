// /workspaces/Vext/components/WithdrawalHistory.tsx
"use client";

import React, { useEffect, useState } from "react";
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
  method?: string;
  phone?: string;
  status?: string;
  receipt?: string;
  createdAt?: any; // Firestore Timestamp, ms, or undefined
  updatedAt?: any;
}

export default function WithdrawalHistory() {
  const [user] = useAuthState(auth);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const ref = collection(db, "users", user.uid, "withdrawals");
    const q = query(ref, orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Withdrawal[] = snapshot.docs.map((doc) => {
          const data = doc.data() as any;

          const methodRaw: string | undefined =
            typeof data.method === "string"
              ? data.method
              : typeof data.channel === "string"
              ? data.channel
              : undefined;

          const phoneRaw: string | undefined =
            typeof data.phoneNumber === "string"
              ? data.phoneNumber
              : typeof data.phone === "string"
              ? data.phone
              : undefined;

          const statusRaw: string | undefined =
            typeof data.status === "string" ? data.status : undefined;

          const receiptRaw: string | undefined =
            typeof data.receipt === "string"
              ? data.receipt
              : typeof data.mpesaReceipt === "string"
              ? data.mpesaReceipt
              : undefined;

          return {
            id: doc.id,
            amount: Number(data.amount) || 0,
            fee: typeof data.fee === "number" ? data.fee : undefined,
            net: typeof data.net === "number" ? data.net : undefined,
            method: methodRaw,
            phone: phoneRaw,
            status: statusRaw,
            receipt: receiptRaw,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          };
        });

        setWithdrawals(list);
        setLoading(false);
      },
      (err) => {
        console.error("[WITHDRAWAL_HISTORY] snapshot error:", err);
        setWithdrawals([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  if (!user) {
    return <p className="p-6">Please log in to view withdrawals.</p>;
  }

  if (loading) {
    return <p className="p-6">Loading withdrawal history…</p>;
  }

  const formatTimestamp = (ts: any): string => {
    try {
      if (!ts) return "—";

      // Firestore Timestamp
      if (ts.toDate && typeof ts.toDate === "function") {
        return ts.toDate().toLocaleString();
      }

      // { seconds, nanoseconds }
      if (typeof ts.seconds === "number") {
        return new Date(ts.seconds * 1000).toLocaleString();
      }

      // Milliseconds or ISO string
      const d = new Date(ts);
      if (!isNaN(d.getTime())) {
        return d.toLocaleString();
      }

      return "—";
    } catch (e) {
      console.error("[WITHDRAWAL_HISTORY] formatTimestamp error:", e, ts);
      return "—";
    }
  };

  const getStatusColor = (status?: string) => {
    const s = status?.toLowerCase() || "";

    if (s === "completed" || s === "success") {
      return "bg-green-100 text-green-700 border-green-400";
    }
    if (s === "processing" || s === "pending" || s === "initiated") {
      return "bg-yellow-100 text-yellow-700 border-yellow-400";
    }
    if (s === "timeout") {
      return "bg-orange-100 text-orange-700 border-orange-400";
    }
    if (s === "failed" || s === "error" || s === "cancelled" || s === "canceled") {
      return "bg-red-100 text-red-700 border-red-400";
    }
    return "bg-gray-100 text-gray-700 border-gray-400";
  };

  const formatStatus = (status?: string): string => {
    if (!status || typeof status !== "string") return "—";
    const s = status.trim().toLowerCase();
    if (!s) return "—";

    switch (s) {
      case "initiated":
        return "Initiated (awaiting M-Pesa)";
      case "pending":
      case "processing":
        return "Processing";
      case "success":
      case "completed":
        return "Successful";
      case "failed":
        return "Failed";
      case "timeout":
        return "Timeout (no response)";
      case "canceled":
        return "Cancelled";
      default:
        return s.charAt(0).toUpperCase() + s.slice(1);
    }
  };

  const formatMethod = (method?: string): string => {
    if (!method) return "—";
    const m = method.toLowerCase();

    if (m.includes("mpesa") || m.includes("m-pesa")) {
      return "M-Pesa (B2C)";
    }
    if (m === "wallet" || m === "internal") {
      return "Internal wallet";
    }

    return method;
  };

  const formatPhone = (phone?: string): string => {
    if (!phone) return "—";
    // Show +254... if missing plus
    if (/^2547\d{8}$/.test(phone)) {
      return `+${phone}`;
    }
    return phone;
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
                    {formatTimestamp(w.createdAt)}
                  </td>
                  <td className="py-2 px-3 font-semibold">
                    KES {w.amount.toFixed(2)}
                  </td>
                  <td className="py-2 px-3">
                    {formatMethod(w.method)}
                  </td>
                  <td className="py-2 px-3">
                    {formatPhone(w.phone)}
                  </td>
                  <td className="py-2 px-3">
                    <span
                      className={`px-2 py-1 rounded-full border text-xs font-semibold ${getStatusColor(
                        w.status
                      )}`}
                    >
                      {formatStatus(w.status)}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-gray-600 text-xs">
                    {w.receipt ? String(w.receipt) : "—"}
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