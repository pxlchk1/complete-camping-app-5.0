/**
 * Feedback Firestore Service
 * Collections: feedbackPosts, feedbackComments
 *
 * This is the single canonical read/write path for Feedback - FeedbackListScreen,
 * FeedbackDetailScreen, and CreateFeedbackScreen all go through here. There used
 * to be a second, parallel implementation (src/services/firestore/feedbackService.ts)
 * that FeedbackListScreen alone used, with a different, incompatible field schema
 * (description/karmaScore instead of body/upvoteCount/downvoteCount) - that's why
 * real posts could show correctly in the list but blank in the detail view, or
 * vice versa. That file has been removed; this is the only implementation now.
 */

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  increment,
  DocumentSnapshot,
  DocumentData,
} from "firebase/firestore";
import firebaseApp from "../config/firebase";
import { FeedbackPost, FeedbackComment, FeedbackCategory, FeedbackStatus } from "../types/community";
import { getUser } from "./userService";

const db = getFirestore(firebaseApp);

// ==================== Legacy-data normalization ====================

// Some existing documents (auto-seeded placeholder content, and posts
// created during a brief window when this file wrote the wrong field
// names) don't match the current schema. Normalizing at read time means
// old content still displays correctly without needing a data migration.
const LEGACY_CATEGORY_MAP: Record<string, FeedbackCategory> = {
  "Feature Request": "feature",
  "Bug Report": "bug",
  "Improvement": "improvement",
  "Question": "question",
  "Other": "other",
};

function normalizeCategory(raw: unknown): FeedbackCategory {
  if (typeof raw !== "string") return "other";
  if (raw in LEGACY_CATEGORY_MAP) return LEGACY_CATEGORY_MAP[raw];
  const valid: FeedbackCategory[] = ["feature", "bug", "improvement", "question", "other"];
  return (valid as string[]).includes(raw) ? (raw as FeedbackCategory) : "other";
}

function normalizeFeedbackPost(id: string, raw: DocumentData): FeedbackPost {
  const upvoteCount = raw.upvoteCount ?? 0;
  const downvoteCount = raw.downvoteCount ?? 0;
  return {
    id,
    title: raw.title || "",
    body: raw.body ?? raw.description ?? "",
    category: normalizeCategory(raw.category),
    authorId: raw.authorId || raw.createdByUserId || "",
    authorName: raw.authorName || undefined,
    createdAt: raw.createdAt,
    status: raw.status || "open",
    voteCount: raw.voteCount ?? raw.karmaScore ?? 0,
    upvoteCount,
    downvoteCount,
    score: raw.score ?? raw.karmaScore ?? (upvoteCount - downvoteCount),
    commentCount: raw.commentCount ?? 0,
  };
}

function normalizeFeedbackComment(id: string, raw: DocumentData): FeedbackComment {
  return {
    id,
    feedbackId: raw.feedbackId,
    body: raw.body ?? raw.description ?? "",
    authorId: raw.authorId || "",
    authorName: raw.authorName || undefined,
    createdAt: raw.createdAt,
  };
}

/**
 * Fill in authorName for any posts/comments that don't already have one
 * stored (legacy content, or content from before authorName was written).
 * Dedupes by authorId so a page of results from the same person is a
 * single profile read.
 */
async function resolveMissingAuthorNames<T extends { authorId: string; authorName?: string }>(
  items: T[]
): Promise<T[]> {
  const missingIds = Array.from(new Set(
    items.filter((i) => !i.authorName && i.authorId).map((i) => i.authorId)
  ));
  if (missingIds.length === 0) return items;

  const resolved = new Map<string, string>();
  await Promise.all(
    missingIds.map(async (authorId) => {
      try {
        const author = await getUser(authorId);
        if (author) resolved.set(authorId, author.displayName || author.handle);
      } catch {
        // Leave unresolved - falls back to "Anonymous" in the UI
      }
    })
  );

  return items.map((item) =>
    item.authorName ? item : { ...item, authorName: resolved.get(item.authorId) }
  );
}

// ==================== Feedback Posts ====================

export async function getFeedbackPosts(
  sortBy: "newest" | "upvoted" = "newest",
  category?: FeedbackCategory,
  limitCount: number = 20,
  lastDoc?: DocumentSnapshot
): Promise<{ posts: FeedbackPost[]; lastDoc: DocumentSnapshot | null }> {
  const postsRef = collection(db, "feedbackPosts");

  try {
    let q = query(postsRef);

    // If category filter is applied, we need a composite index
    // For now, we'll fetch all and filter client-side to avoid index requirements
    if (sortBy === "newest") {
      q = query(q, orderBy("createdAt", "desc"), limit(limitCount * 2)); // Fetch extra for client-side filtering
    } else if (sortBy === "upvoted") {
      q = query(q, orderBy("voteCount", "desc"), limit(limitCount * 2));
    } else {
      q = query(q, limit(limitCount * 2));
    }

    if (lastDoc) {
      q = query(q, startAfter(lastDoc));
    }

    const snapshot = await getDocs(q);

    // Apply category filter client-side (compares against the raw stored
    // value, which may be legacy long-form - normalize both sides)
    let filteredDocs = snapshot.docs;
    if (category) {
      filteredDocs = snapshot.docs.filter((d) => normalizeCategory(d.data().category) === category);
    }

    // Limit to requested count
    const limitedDocs = filteredDocs.slice(0, limitCount);

    const posts = await resolveMissingAuthorNames(
      limitedDocs.map((d) => normalizeFeedbackPost(d.id, d.data()))
    );

    const lastVisible = limitedDocs[limitedDocs.length - 1] || null;

    return { posts, lastDoc: lastVisible };
  } catch (error: any) {
    console.error("Error fetching feedback posts:", error);

    if (error.code === "permission-denied") {
      throw new Error("Unable to load feedback. Please check your connection.");
    }

    throw error;
  }
}

export async function getFeedbackPostById(postId: string): Promise<FeedbackPost | null> {
  try {
    const postRef = doc(db, "feedbackPosts", postId);
    const postSnap = await getDoc(postRef);

    if (!postSnap.exists()) {
      return null;
    }

    const [post] = await resolveMissingAuthorNames([
      normalizeFeedbackPost(postSnap.id, postSnap.data()),
    ]);
    return post;
  } catch (error: any) {
    console.error("Error fetching feedback post:", error);
    throw new Error("Unable to load feedback post. Please try again.");
  }
}

export async function createFeedbackPost(data: {
  title: string;
  body: string;
  category: FeedbackCategory;
  authorId: string;
  authorName?: string;
}): Promise<string> {
  const postsRef = collection(db, "feedbackPosts");

  const docRef = await addDoc(postsRef, {
    title: data.title,
    body: data.body,
    category: data.category,
    authorId: data.authorId,
    createdByUserId: data.authorId,
    authorName: data.authorName || null,
    createdAt: serverTimestamp(),
    status: "open" as FeedbackStatus,
    voteCount: 0,
    upvoteCount: 0,
    downvoteCount: 0,
    score: 0,
    commentCount: 0,
  });

  return docRef.id;
}

export async function upvoteFeedbackPost(postId: string): Promise<void> {
  const postRef = doc(db, "feedbackPosts", postId);
  await updateDoc(postRef, {
    voteCount: increment(1),
  });
}

// ==================== Feedback Comments ====================

export async function getFeedbackComments(
  feedbackId: string,
  limitCount: number = 50
): Promise<FeedbackComment[]> {
  const commentsRef = collection(db, "feedbackComments");

  try {
    const q = query(
      commentsRef,
      where("feedbackId", "==", feedbackId),
      orderBy("createdAt", "asc"),
      limit(limitCount)
    );

    const snapshot = await getDocs(q);
    return resolveMissingAuthorNames(
      snapshot.docs.map((d) => normalizeFeedbackComment(d.id, d.data()))
    );
  } catch (error: any) {
    console.error("Error fetching feedback comments:", error);

    // If index is missing, try a simpler query
    const errorCode = error?.code;
    const errorMessage = typeof error?.message === 'string' ? error.message : '';

    if (errorCode === "failed-precondition" || errorMessage.includes("index")) {
      const simpleQuery = query(commentsRef, where("feedbackId", "==", feedbackId));
      const snapshot = await getDocs(simpleQuery);

      const comments = snapshot.docs.map((d) => normalizeFeedbackComment(d.id, d.data()));

      comments.sort((a, b) => {
        const aTime = typeof a.createdAt === "string"
          ? new Date(a.createdAt)
          : (a.createdAt as any)?.toDate?.() || new Date();
        const bTime = typeof b.createdAt === "string"
          ? new Date(b.createdAt)
          : (b.createdAt as any)?.toDate?.() || new Date();
        return aTime.getTime() - bTime.getTime();
      });

      return resolveMissingAuthorNames(comments);
    }

    throw error;
  }
}

export async function addFeedbackComment(data: {
  feedbackId: string;
  body: string;
  authorId: string;
  authorName?: string;
}): Promise<string> {
  const commentsRef = collection(db, "feedbackComments");

  const docRef = await addDoc(commentsRef, {
    feedbackId: data.feedbackId,
    body: data.body,
    authorId: data.authorId,
    authorName: data.authorName || null,
    createdAt: serverTimestamp(),
  });

  // Increment comment count
  const postRef = doc(db, "feedbackPosts", data.feedbackId);
  await updateDoc(postRef, {
    commentCount: increment(1),
  });

  return docRef.id;
}
