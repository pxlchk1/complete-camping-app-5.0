import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../config/firebase";

export type AdminCheckStatus = "checking" | "admin" | "not-admin";

/**
 * Checks whether the signed-in user is an admin, using the same
 * users/{uid}.isAdmin / role fields AdminPhotosScreen already checked
 * locally. Used by AdminGate to gate every admin screen — previously none
 * of the 8 admin routes had any check above the Firestore/Cloud Function
 * layer, so anyone who guessed or found a route name could open them.
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

    getDoc(doc(db, "users", uid))
      .then((userDoc) => {
        if (cancelled) return;
        const data = userDoc.data();
        const isAdmin =
          data?.isAdmin === true || data?.role === "admin" || data?.role === "administrator";
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
