import { NextRequest, NextResponse } from "next/server";
import { initAdmin } from "@/lib/firebaseAdmin";

export async function GET(req: NextRequest, { params }: { params: { uid: string } }) {
  try {
    const { adminDb } = initAdmin();
    const { uid } = params;

    const snap = await adminDb.collection("users").doc(uid).get();

    if (!snap.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(snap.data());
  } catch (err) {
    console.error("User fetch error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
