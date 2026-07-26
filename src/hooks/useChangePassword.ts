import { useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { auth } from "../config/firebase";

export type ChangePasswordField = "currentPassword" | "newPassword" | "confirmPassword";

export type ChangePasswordResult =
  | { success: true }
  | { success: false; error: string; field?: ChangePasswordField };

/**
 * Shared password-change flow: validates, re-authenticates, then updates the
 * Firebase Auth password. Previously duplicated near-verbatim across
 * EditProfileScreen and SettingsScreen — this is the one copy. Screens own
 * how they surface the returned error (toast, inline field error, etc).
 */
export function useChangePassword() {
  const [updating, setUpdating] = useState(false);

  const changePassword = async (
    currentPassword: string,
    newPassword: string,
    confirmPassword: string
  ): Promise<ChangePasswordResult> => {
    const user = auth.currentUser;
    if (!user || !user.email) {
      return { success: false, error: "You must be signed in." };
    }

    if (!currentPassword.trim()) {
      return { success: false, error: "Current password is required.", field: "currentPassword" };
    }
    if (!newPassword.trim()) {
      return { success: false, error: "New password is required.", field: "newPassword" };
    }
    if (newPassword.length < 8) {
      return { success: false, error: "Password must be at least 8 characters.", field: "newPassword" };
    }
    if (currentPassword === newPassword) {
      return { success: false, error: "New password must be different from your current password.", field: "newPassword" };
    }
    if (!confirmPassword.trim()) {
      return { success: false, error: "Please confirm your new password.", field: "confirmPassword" };
    }
    if (newPassword !== confirmPassword) {
      return { success: false, error: "Passwords do not match.", field: "confirmPassword" };
    }

    try {
      setUpdating(true);
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      return { success: true };
    } catch (error: any) {
      if (error.code === "auth/wrong-password" || error.code === "auth/invalid-credential") {
        return { success: false, error: "The current password you entered is incorrect.", field: "currentPassword" };
      }
      if (error.code === "auth/weak-password") {
        return { success: false, error: "Please choose a stronger password.", field: "newPassword" };
      }
      if (error.code === "auth/requires-recent-login") {
        return { success: false, error: "For security, please sign out and sign back in, then try again." };
      }
      return { success: false, error: error.message || "Failed to update password. Please try again." };
    } finally {
      setUpdating(false);
    }
  };

  return { changePassword, updating };
}
