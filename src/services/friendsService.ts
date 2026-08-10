/**
 * Friends / My Campground Service
 * Collections: friendRequests, users/{uid}/friends, users/{uid}/campgroundMembers
 *
 * One social graph: "Friends" is everyone the user is connected to via a
 * mutual accepted request. "My Campground" is a personal, one-sided tag on
 * top of that graph - the subset of friends a user has marked as people
 * they actually go camping with. Trip rosters (campgroundContacts /
 * TripParticipant) are a separate, existing system - AddPeopleToTripScreen
 * lazily provisions a linked campgroundContacts doc the first time a pure
 * Friend (no existing contact record) is added to a trip, so that system
 * doesn't need to change.
 */

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
} from "firebase/firestore";
import firebaseApp from "../config/firebase";
import { getUser } from "./userService";
import { Friend, FriendRequest, FriendshipStatus } from "../types/friends";
import { User } from "../types/user";

const db = getFirestore(firebaseApp);

// Unicode's highest-valued codepoint, used as an upper bound so
// `handle >= q && handle <= q + HIGH_CODEPOINT` matches any handle
// starting with q - Firestore has no native prefix/full-text search.
const HIGH_CODEPOINT = "";

// ==================== Search ====================

export async function searchUsersByHandle(handlePrefix: string, excludeUserId: string): Promise<User[]> {
  const normalized = handlePrefix.trim().toLowerCase().replace(/^@+/, "");
  if (!normalized) return [];

  const profilesRef = collection(db, "profiles");
  const q = query(
    profilesRef,
    where("handle", ">=", normalized),
    where("handle", "<=", normalized + HIGH_CODEPOINT),
    orderBy("handle"),
    limit(20)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }) as User)
    .filter((u) => u.id !== excludeUserId);
}

// ==================== Friend Requests ====================

export async function getIncomingFriendRequests(userId: string): Promise<FriendRequest[]> {
  const q = query(
    collection(db, "friendRequests"),
    where("toUserId", "==", userId),
    where("status", "==", "pending")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as FriendRequest);
}

export async function getOutgoingFriendRequests(userId: string): Promise<FriendRequest[]> {
  const q = query(
    collection(db, "friendRequests"),
    where("fromUserId", "==", userId),
    where("status", "==", "pending")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as FriendRequest);
}

/**
 * Status between the signed-in user and a target profile, used to render
 * the right button on someone's My Campsite profile ("Add Friend" /
 * "Request Sent" / "Accept Request" / "Friends").
 */
export interface FriendConnection {
  status: FriendshipStatus;
  // The pending request between these two users, when status is
  // pending_outgoing or pending_incoming - callers need the id to cancel
  // or accept it.
  request: FriendRequest | null;
}

/**
 * Full connection state between the signed-in user and a target profile,
 * used to render the right button on someone's My Campsite profile
 * ("Add Friend" / "Request Sent" / "Accept Request" / "Friends").
 */
export async function getFriendConnection(userId: string, targetUserId: string): Promise<FriendConnection> {
  const friendDoc = await getDoc(doc(db, "users", userId, "friends", targetUserId));
  if (friendDoc.exists()) return { status: "friends", request: null };

  const outgoing = await getDocs(
    query(
      collection(db, "friendRequests"),
      where("fromUserId", "==", userId),
      where("toUserId", "==", targetUserId),
      where("status", "==", "pending")
    )
  );
  if (!outgoing.empty) {
    const d = outgoing.docs[0];
    return { status: "pending_outgoing", request: { id: d.id, ...d.data() } as FriendRequest };
  }

  const incoming = await getDocs(
    query(
      collection(db, "friendRequests"),
      where("fromUserId", "==", targetUserId),
      where("toUserId", "==", userId),
      where("status", "==", "pending")
    )
  );
  if (!incoming.empty) {
    const d = incoming.docs[0];
    return { status: "pending_incoming", request: { id: d.id, ...d.data() } as FriendRequest };
  }

  return { status: "none", request: null };
}

export async function sendFriendRequest(fromUserId: string, toUserId: string): Promise<string> {
  if (fromUserId === toUserId) {
    throw new Error("You can't friend yourself.");
  }

  const [fromUser, toUser] = await Promise.all([getUser(fromUserId), getUser(toUserId)]);
  if (!fromUser || !toUser) {
    throw new Error("Couldn't find that user.");
  }

  const docRef = await addDoc(collection(db, "friendRequests"), {
    fromUserId,
    fromDisplayName: fromUser.displayName || "Camper",
    fromHandle: fromUser.handle || "",
    fromAvatarUrl: fromUser.photoURL || null,
    toUserId,
    toDisplayName: toUser.displayName || "Camper",
    toHandle: toUser.handle || "",
    toAvatarUrl: toUser.photoURL || null,
    status: "pending",
    createdAt: serverTimestamp(),
    respondedAt: null,
  });

  return docRef.id;
}

export async function cancelFriendRequest(requestId: string): Promise<void> {
  await deleteDoc(doc(db, "friendRequests", requestId));
}

export async function declineFriendRequest(requestId: string): Promise<void> {
  await updateDoc(doc(db, "friendRequests", requestId), {
    status: "declined",
    respondedAt: serverTimestamp(),
  });
}

/**
 * Accept a request: mirror a Friend doc on both sides and mark the
 * request accepted, in one atomic batch.
 */
export async function acceptFriendRequest(request: FriendRequest): Promise<void> {
  const batch = writeBatch(db);

  const requestRef = doc(db, "friendRequests", request.id);
  batch.update(requestRef, { status: "accepted", respondedAt: serverTimestamp() });

  const fromMirrorRef = doc(db, "users", request.fromUserId, "friends", request.toUserId);
  batch.set(fromMirrorRef, {
    friendUid: request.toUserId,
    displayName: request.toDisplayName,
    handle: request.toHandle,
    avatarUrl: request.toAvatarUrl || null,
    since: serverTimestamp(),
  });

  const toMirrorRef = doc(db, "users", request.toUserId, "friends", request.fromUserId);
  batch.set(toMirrorRef, {
    friendUid: request.fromUserId,
    displayName: request.fromDisplayName,
    handle: request.fromHandle,
    avatarUrl: request.fromAvatarUrl || null,
    since: serverTimestamp(),
  });

  await batch.commit();
}

/**
 * Remove a friendship. Also un-tags them from My Campground if present,
 * since a tag on a non-friend doesn't mean anything.
 */
export async function removeFriend(userId: string, friendUid: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, "users", userId, "friends", friendUid));
  batch.delete(doc(db, "users", friendUid, "friends", userId));
  batch.delete(doc(db, "users", userId, "campgroundMembers", friendUid));
  await batch.commit();
}

// ==================== Friends list ====================

export async function getFriends(userId: string): Promise<Friend[]> {
  const [friendsSnap, campgroundSnap] = await Promise.all([
    getDocs(query(collection(db, "users", userId, "friends"), orderBy("displayName"))),
    getDocs(collection(db, "users", userId, "campgroundMembers")),
  ]);

  const campgroundUids = new Set(campgroundSnap.docs.map((d) => d.id));

  return friendsSnap.docs.map((d) => ({
    ...(d.data() as Omit<Friend, "friendUid" | "inCampground">),
    friendUid: d.id,
    inCampground: campgroundUids.has(d.id),
  }));
}

export async function getFriendCount(userId: string): Promise<number> {
  const snapshot = await getDocs(collection(db, "users", userId, "friends"));
  return snapshot.size;
}

// ==================== My Campground tagging ====================

export async function addToCampground(userId: string, friend: Friend): Promise<void> {
  await setDoc(doc(db, "users", userId, "campgroundMembers", friend.friendUid), {
    friendUid: friend.friendUid,
    addedAt: serverTimestamp(),
  });
}

export async function removeFromCampground(userId: string, friendUid: string): Promise<void> {
  await deleteDoc(doc(db, "users", userId, "campgroundMembers", friendUid));
}
