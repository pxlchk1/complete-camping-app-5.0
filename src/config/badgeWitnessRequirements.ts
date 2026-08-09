/**
 * Badge Witness Requirements Configuration
 *
 * Whether a badge needs a witness is read from its BadgeDefinition.earnType
 * ("WITNESS_REQUIRED") in Firestore - that's the single source of truth.
 * This file only supplies the human-readable copy explaining *why*, shown
 * on BadgeDetailScreen once a badge is already known to require one.
 */

/**
 * Normalize a badge ID or name to snake_case for consistent matching.
 * Handles Firestore doc IDs which may be mixed-case or have underscores.
 */
export function normalizeBadgeId(badgeId: string): string {
  return badgeId
    .toLowerCase()
    .replace(/\s+/g, "_")      // spaces to underscores
    .replace(/-/g, "_")        // hyphens to underscores
    .replace(/[^a-z0-9_]/g, "") // remove special chars
    .replace(/_+/g, "_")       // collapse multiple underscores
    .replace(/^_|_$/g, "");    // trim leading/trailing underscores
}

/**
 * Get a human-readable description of why witness is required.
 * Used in UI to explain the witness requirement to users.
 */
export function getWitnessRequirementReason(badgeId: string): string {
  const normalizedId = normalizeBadgeId(badgeId);
  
  // Fire-related
  if (normalizedId.includes("fire") || normalizedId.includes("spark") || normalizedId.includes("match")) {
    return "Fire skills need a spotter for safety and verification.";
  }
  
  // Navigation-related
  if (normalizedId.includes("nav") || normalizedId.includes("compass") || normalizedId.includes("map") || normalizedId.includes("trail")) {
    return "Navigation skills are best verified by someone who followed along.";
  }
  
  // Safety-related
  if (normalizedId.includes("first_aid") || normalizedId.includes("emergency") || normalizedId.includes("weather") || normalizedId.includes("water_treatment")) {
    return "Safety skills should be witnessed for proper technique verification.";
  }
  
  // Setup-related
  if (normalizedId.includes("tent") || normalizedId.includes("hammock") || normalizedId.includes("group")) {
    return "Camp setup is easier to verify with a fellow camper present.";
  }
  
  // Default
  return "A fellow camper can confirm you completed this challenge.";
}
