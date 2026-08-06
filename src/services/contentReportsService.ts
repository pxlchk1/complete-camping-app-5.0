/**
 * Content Reports Firestore Service
 * Collection: reports
 *
 * Writes to the same "reports" collection + schema AdminReportsScreen and
 * AdminDashboardScreen read (contentType/contentId/reportedBy/reportedAt/
 * status: "pending"). This used to write to a different, unrelated
 * "contentReports" collection with a different schema — every report a
 * user submitted was invisible to both admin screens.
 */

import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import firebaseApp from "../config/firebase";
import { ReportTargetType } from "../types/community";

const db = getFirestore(firebaseApp);

export async function reportContent(data: {
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  reporterId: string;
}): Promise<string> {
  const reportsRef = collection(db, "reports");

  const docRef = await addDoc(reportsRef, {
    contentType: data.targetType,
    contentId: data.targetId,
    reason: data.reason,
    reportedBy: data.reporterId,
    reportedAt: serverTimestamp(),
    status: "pending",
  });

  return docRef.id;
}
