import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { User } from "../types/user";

interface UserState {
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  updateCurrentUser: (updates: Partial<User>) => void;
  clearCurrentUser: () => void;
  isAuthenticated: () => boolean;
  isModerator: () => boolean;
  isAdministrator: () => boolean;
  hasGrantedMembership: () => boolean;
  hasUsedFreeTrip: boolean;
  setHasUsedFreeTrip: (used: boolean) => void;
  // Admin-only debug toggle: lets an administrator preview the app as a
  // free (non-Pro) user would see it, without touching their real
  // entitlement. See isAdminProBypassActive() below for how gating
  // checks respect this.
  previewAsFreeUser: boolean;
  setPreviewAsFreeUser: (value: boolean) => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      hasUsedFreeTrip: false,

      setCurrentUser: (user) => set({ currentUser: user }),

      updateCurrentUser: (updates) =>
        set((state) => ({
          currentUser: state.currentUser
            ? { ...state.currentUser, ...updates }
            : null,
        })),

      clearCurrentUser: () => set({ currentUser: null }),

      isAuthenticated: () => get().currentUser !== null,

      isModerator: () => {
        const user = get().currentUser;
        return user?.role === "moderator" || user?.role === "administrator" || user?.membershipTier === "isModerator";
      },

      isAdministrator: () => {
        const user = get().currentUser;
        return user?.role === "administrator" || user?.membershipTier === "isAdmin";
      },

      // True when an admin has granted this user a subscription via
      // grantMembership() (Award Subscription) — checked in addition to
      // RevenueCat's isPro so an admin-granted membership actually unlocks
      // Pro features rather than only updating a Firestore field nothing
      // reads. Lifetime grants have no membershipExpiresAt.
      hasGrantedMembership: () => {
        const user = get().currentUser;
        if (user?.membershipTier !== "subscribed") return false;
        if (!user.membershipExpiresAt) return true;
        return new Date(user.membershipExpiresAt) > new Date();
      },

      setHasUsedFreeTrip: (used) => set({ hasUsedFreeTrip: used }),

      previewAsFreeUser: false,
      setPreviewAsFreeUser: (value) => set({ previewAsFreeUser: value }),
    }),
    {
      name: "user-storage",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

// Selector hooks
export const useCurrentUser = () => useUserStore((s) => s.currentUser);
export const useIsAuthenticated = () => useUserStore((s) => s.isAuthenticated());
export const useIsModerator = () => useUserStore((s) => s.isModerator());
export const useIsAdministrator = () => useUserStore((s) => s.isAdministrator());
export const useIsPreviewingAsFreeUser = () => useUserStore((s) => s.previewAsFreeUser);

/**
 * Whether an admin's Pro/paywall bypass should currently apply.
 * True for admins UNLESS they've turned on "preview as free user" -
 * in which case they should see exactly what a non-paid user sees.
 * Use this instead of a bare isAdministrator() check anywhere that
 * bypass is used to skip paywalls/upsells.
 */
export function isAdminProBypassActive(): boolean {
  const state = useUserStore.getState();
  return state.isAdministrator() && !state.previewAsFreeUser;
}

// Helper to create test user (for development)
export function createTestUser(role: User["role"] = "administrator"): User {
  return {
    id: "test_user_1",
    email: "alana@tentandlantern.com",
    handle: "tentandlantern",
    displayName: "Alana Waters Piper",
    photoURL: undefined,
    role,
    membershipTier: "isAdmin",
    membershipExpiresAt: undefined,
    isBanned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

