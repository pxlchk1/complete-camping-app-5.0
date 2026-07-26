// Shared handle rules for any screen that lets a user set their public @handle.
// Previously duplicated verbatim across EditProfileScreen and SettingsScreen —
// kept in one place so the reserved list and validation rules can't drift apart.

export const ADMIN_EMAIL = "alana@tentandlantern.com";

export const RESERVED_HANDLES = [
  // Brand and product
  "tentandlantern",
  "tentlantern",
  "tentandlanternapp",
  "completecampingapp",
  "completecamping",
  "thecompletecampingapp",
  "tentandlanternofficial",
  "tentandlanternhq",
  "tentandlanternteam",
  "tentandlanternsupport",

  // Variants people will try
  "tent_and_lantern",
  "tent_lantern",
  "complete_camping_app",
  "complete_camping",
  "camping_app",
  "campingapp",

  // Staff and authority impersonation
  "admin",
  "administrator",
  "root",
  "owner",
  "moderator",
  "mod",
  "staff",
  "team",
  "official",
  "support",
  "help",
  "security",
  "trust",
  "trustandsafety",
  "safety",
  "billing",
  "payments",
  "payment",
  "refund",
  "refunds",
  "subscriptions",
  "subscription",
  "premium",
  "pro",
  "plus",
  "developer",
  "dev",

  // App navigation and core features
  "plan",
  "trips",
  "trip",
  "newtrip",
  "packing",
  "packinglist",
  "packinglists",
  "gear",
  "gearcloset",
  "mygear",
  "meal",
  "meals",
  "mealplan",
  "mealplans",
  "shopping",
  "shoppinglist",
  "parks",
  "park",
  "campground",
  "campgrounds",
  "itinerary",
  "itinerarylinks",
  "links",
  "weather",
  "learn",
  "skills",
  "leavenotrace",
  "lnt",
  "connect",
  "community",
  "askacamper",
  "campfire",
  "mycampsite",
  "campsite",
  "profile",
  "account",
  "settings",
  "notifications",
  "favorites",
  "favorite",

  // System and technical words that cause confusion
  "api",
  "app",
  "system",
  "null",
  "undefined",
  "test",
  "tester",
  "demo",
  "staging",
  "production",
  "prod",
  "beta",
  "qa",

  // Messaging and contact
  "email",
  "mail",
  "sms",
  "text",
  "contact",
  "press",
  "media",
  "partnerships",
  "partners",

  // Avoid platform brand impersonation
  "apple",
  "appstore",
  "google",
  "android",
  "ios",
  "firebase",
  "revenuecat",
];

export function isAdminEmail(email: string | null | undefined): boolean {
  return (email || "").toLowerCase() === ADMIN_EMAIL;
}

/**
 * Validates a candidate handle and returns a single human-readable error
 * message, or null if the handle is valid. Does not check uniqueness
 * against Firestore — callers handle that separately.
 */
export function validateHandle(rawHandle: string, isAdmin: boolean): string | null {
  const handle = rawHandle.trim();

  if (!handle) {
    return "Please enter a handle";
  }

  const cleanHandle = handle.toLowerCase();

  if (cleanHandle.length < 3 || cleanHandle.length > 30) {
    return "Handle must be between 3 and 30 characters";
  }

  if (!/^[a-z0-9_-]+$/.test(cleanHandle)) {
    return "Handle can only contain lowercase letters, numbers, hyphens, and underscores";
  }

  if (RESERVED_HANDLES.includes(cleanHandle) && !isAdmin) {
    return "This handle is reserved. Please choose a different one.";
  }

  return null;
}
