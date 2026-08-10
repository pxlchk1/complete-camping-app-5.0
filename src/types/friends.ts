/**
 * Friends / My Campground Types
 * One social graph: "Friends" is everyone you're connected to, "My
 * Campground" is the subset you've personally tagged as people you
 * actually go camping with.
 */

import { Timestamp } from "firebase/firestore";

export type FriendRequestStatus = "pending" | "accepted" | "declined";

export interface FriendRequest {
  id: string;
  fromUserId: string;
  fromDisplayName: string;
  fromHandle: string;
  fromAvatarUrl?: string | null;
  toUserId: string;
  toDisplayName: string;
  toHandle: string;
  toAvatarUrl?: string | null;
  status: FriendRequestStatus;
  createdAt: Timestamp | string;
  respondedAt?: Timestamp | string | null;
}

// Mirrored under users/{uid}/friends/{friendUid} on both sides once accepted
export interface Friend {
  friendUid: string;
  displayName: string;
  handle: string;
  avatarUrl?: string | null;
  since: Timestamp | string;
  // true when this friend is also tagged in the viewer's own My Campground
  inCampground?: boolean;
}

export type FriendshipStatus = "none" | "pending_outgoing" | "pending_incoming" | "friends";
