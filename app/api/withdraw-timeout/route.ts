// /workspaces/Vext/app/api/withdraw-timeout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    console.log("Withdraw Timeout received:", JSON.stringify(data, null, 2));

    const result = data?.Result || data?.result || {};
    const originatorConversationId = result?.OriginatorConversationID || null;

    if (originatorConversationId) {
      const indexDoc = await adminDb
        .collection("_withdrawal_index")
        .doc(originatorConversationId)
        .get();

      if (indexDoc.exists) {
        const { providerId, withdrawalId } = indexDoc.data() as {
          providerId: string;
          withdrawalId: string;
        };

        await adminDb
          .collection("users")
          .doc(providerId)
          .collection("withdrawals")
          .doc(withdrawalId)
          .set(
            {
              status: "timeout",
              updatedAt: new Date(),
            },
            { merge: true }
          );
      }
    }

    return NextResponse.json({ ResultCode: 0, ResultDesc: "Timeout handled" });
  } catch (err: any) {
    console.error("Withdraw Timeout error:", err);
    return NextResponse.json(
      { ResultCode: 1, ResultDesc: "Timeout processing error" },
      { status: 500 }
    );
  }
}