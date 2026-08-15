/**
 * Trip Share Invite Service
 * "Share this specific trip with anyone via a link" - the invite-anyone
 * path for trip collaboration (mirrors campgroundInviteService.ts, which
 * handles the more general "become my camping friend" invite).
 *
 * The permission ("view" or "edit") is chosen by the trip owner when the
 * invite is created and baked into the invite itself - see
 * redeemTripShareInvite in functions/src/index.ts for how it's applied.
 */

import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import firebaseApp from "../config/firebase";
import { getTripShareInviteLinkUrl, getCopyableTripShareInviteText } from "../constants/appLinks";

const functions = getFunctions(firebaseApp);
const db = getFirestore(firebaseApp);

export type TripSharePermission = "view" | "edit";

export interface TripShareInvite {
  id: string;
  inviterUid: string;
  inviterName: string;
  tripId: string;
  tripName: string;
  permission: TripSharePermission;
  inviteeEmail?: string;
  token: string;
  status: "pending" | "accepted" | "revoked" | "expired";
}

export interface CreateTripShareInviteData {
  tripId: string;
  inviterName: string;
  permission: TripSharePermission;
  inviteeEmail?: string;
}

export interface CreateTripShareInviteResult {
  success: boolean;
  inviteId: string;
  token: string;
  inviteLink: string;
}

export interface RedeemTripShareInviteResult {
  success: boolean;
  message: string;
  tripId: string;
  tripName: string;
  permission: TripSharePermission;
}

const createTripShareInviteFunc = httpsCallable<CreateTripShareInviteData, CreateTripShareInviteResult>(
  functions,
  "createTripShareInvite"
);
const sendTripShareInviteEmailFunc = httpsCallable<{ inviteId: string }, { success: boolean; message: string }>(
  functions,
  "sendTripShareInviteEmail"
);
const redeemTripShareInviteFunc = httpsCallable<{ token: string }, RedeemTripShareInviteResult>(
  functions,
  "redeemTripShareInvite"
);

/**
 * Create a trip share invite. The Cloud Function independently verifies
 * the caller actually owns the trip - this isn't just a client-side gate.
 */
export async function createTripShareInvite(
  data: CreateTripShareInviteData
): Promise<CreateTripShareInviteResult> {
  try {
    const result = await createTripShareInviteFunc(data);
    return result.data;
  } catch (error: any) {
    console.error("[tripShareInviteService] createTripShareInvite failed:", error);
    throw new Error(error.message || "Failed to create trip invite");
  }
}

/**
 * Email a trip share invite via Cloud Function (SendGrid)
 */
export async function sendTripShareInviteEmail(inviteId: string): Promise<{ success: boolean; message: string }> {
  try {
    const result = await sendTripShareInviteEmailFunc({ inviteId });
    return result.data;
  } catch (error: any) {
    const errorMessage = error?.details || error?.message || "Failed to send invite email";
    console.error("[tripShareInviteService] sendTripShareInviteEmail failed:", errorMessage);
    throw new Error(errorMessage);
  }
}

/**
 * Redeem a trip share invite by token. Adds the current user to the
 * trip's memberIds (and editorIds, if the invite grants edit access).
 */
export async function redeemTripShareInvite(token: string): Promise<RedeemTripShareInviteResult> {
  try {
    const result = await redeemTripShareInviteFunc({ token });
    return result.data;
  } catch (error: any) {
    console.error("[tripShareInviteService] redeemTripShareInvite failed:", error);
    throw new Error(error.message || "Failed to redeem invite");
  }
}

/**
 * Get an invite by ID (for display purposes)
 */
export async function getTripShareInviteById(inviteId: string): Promise<TripShareInvite | null> {
  try {
    const inviteRef = doc(db, "tripShareInvites", inviteId);
    const inviteSnap = await getDoc(inviteRef);
    if (!inviteSnap.exists()) return null;
    return { id: inviteSnap.id, ...inviteSnap.data() } as TripShareInvite;
  } catch (error: any) {
    console.error("[tripShareInviteService] getTripShareInviteById failed:", error);
    throw new Error(error.message || "Failed to get invite");
  }
}

/**
 * Generate the shareable link for a trip invite token
 */
export function getTripShareLink(token: string): string {
  return getTripShareInviteLinkUrl(token);
}

/**
 * Generate the copyable/shareable invite text for the native share sheet
 */
export function generateTripShareMessage(
  inviterName: string,
  tripName: string,
  token: string,
  permission: TripSharePermission
): string {
  const firstName = inviterName?.trim().split(/\s+/)[0] || "A friend";
  return getCopyableTripShareInviteText(firstName, tripName, token, permission);
}
