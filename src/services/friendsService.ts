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

/**
 * Search for people to friend by @handle OR display name.
 *
 * Firestore has no native full-text/case-insensitive search, so this runs
 * two prefix-range queries in parallel - one against the (already
 * lowercase) handle field, one against displayName trying both the raw
 * input and a capitalized version (names are conventionally capitalized,
 * handles aren't) - and merges/dedupes the results. Not a substring or
 * fuzzy match, but a meaningful improvement over handle-only search,
 * without a schema migration to add a lowercase display-name index.
 */
export async function searchUsersByHandle(handlePrefix: string, excludeUserId: string): Promise<User[]> {
  const raw = handlePrefix.trim().replace(/^@+/, "");
  if (!raw) return [];

  const normalizedHandle = raw.toLowerCase();
  const capitalized = raw.charAt(0).toUpperCase() + raw.slice(1);

  const profilesRef = collection(db, "profiles");

  const handleQuery = query(
    profilesRef,
    where("handle", ">=", normalizedHandle),
    where("handle", "<=", normalizedHandle + HIGH_CODEPOINT),
    orderBy("handle"),
    limit(20)
  );

  const nameQueries = Array.from(new Set([raw, capitalized])).map((prefix) =>
    query(
      profilesRef,
      where("displayName", ">=", prefix),
      where("displayName", "<=", prefix + HIGH_CODEPOINT),
      orderBy("displayName"),
      limit(20)
    )
  );

  const snapshots = await Promise.all([handleQuery, ...nameQueries].map((q) => getDocs(q)));

  const byId = new Map<string, User>();
  for (const snapshot of snapshots) {
    for (const d of snapshot.docs) {
      if (d.id === excludeUserId) continue;
      byId.set(d.id, { id: d.id, ...d.data() } as User);
    }
  }

  return Array.from(byId.values());
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
