/**
 * Badge Catalog Cache
 *
 * The 63 badge definitions barely ever change, and their artwork is already
 * bundled locally (see assets/images/merit_badges) - there's no reason
 * viewing the catalog should require a live connection. This caches the
 * last successfully fetched catalog so meritBadgesService.getAllBadgeDefinitions()
 * can fall back to it when Firestore is unreachable, instead of the Merit
 * Badges screen going straight to a hard error.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BadgeDefinition } from "../types/badges";

interface BadgeCatalogState {
  definitions: BadgeDefinition[];
  lastFetchedAt: string | null;
  setDefinitions: (definitions: BadgeDefinition[]) => void;
}

export const useBadgeCatalogStore = create<BadgeCatalogState>()(
  persist(
    (set) => ({
      definitions: [],
      lastFetchedAt: null,
      setDefinitions: (definitions) =>
        set({ definitions, lastFetchedAt: new Date().toISOString() }),
    }),
    {
      name: "badge-catalog-storage",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
