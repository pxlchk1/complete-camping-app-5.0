import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../config/firebase";

export type AdminCheckStatus = "checking" | "admin" | "not-admin";

function isAdminData(data: Record<string, any> | undefined): boolean {
  return (
    data?.isAdmin === true ||
    data?.role === "admin" ||
    data?.role === "administrator" ||
    data?.membershipTier === "isAdmin"
  );
}

/**
 * Checks whether the signed-in user is an admin. Mirrors firestore.rules'
 * isAdmin(), which checks both profiles/{uid} and users/{uid} for
 * isAdmin/role/membershipTier — this previously only checked users/{uid}
 * and skipped membershipTier, which is the documented way to grant admin
 * (src/scripts/updateMembershipTiers.ts), locking out admins provisioned
 * that way even though the rules would have allowed them through.
 * Used by AdminGate to gate every admin screen.
 */
export function useIsAdmin(): AdminCheckStatus {
  const [status, setStatus] = useState<AdminCheckStatus>("checking");

  useEffect(() => {
    let cancelled = false;
    const uid = auth.currentUser?.uid;

    if (!uid) {
      setStatus("not-admin");
      return;
    }

    Promise.all([getDoc(doc(db, "profiles", uid)), getDoc(doc(db, "users", uid))])
      .then(([profileDoc, userDoc]) => {
        if (cancelled) return;
        const isAdmin = isAdminData(profileDoc.data()) || isAdminData(userDoc.data());
        setStatus(isAdmin ? "admin" : "not-admin");
      })
      .catch((error) => {
        console.error("[useIsAdmin] Error checking admin status:", error);
        if (!cancelled) setStatus("not-admin");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
