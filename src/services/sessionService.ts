/**
 * Session Service
 *
 * Tracks app-open/session counts locally so subscription prompts (and
 * analytics) can reason about "how many times has this person used the
 * app" without a server round trip. A "session" here means one cold start
 * of the app (recordAppOpen is called once per launch from App.tsx).
 *
 * Also owns the single global "has a full-screen paywall already been
 * shown this session" flag, since several independent prompts (first-trip,
 * contextual gates, returning-user) all need to respect the same
 * one-full-screen-paywall-per-session rule.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const SESSION_COUNT_KEY = "@sessionCount";
const LAST_SESSION_AT_KEY = "@lastSessionAt";
const LAST_RETURNING_USER_PROMPT_KEY = "@lastReturningUserPromptAt";

// In-memory only - intentionally NOT persisted, so it resets every cold
// start. This is what "per session" means for the paywall frequency rule.
let fullScreenPaywallShownThisSession = false;
let cachedSessionNumber: number | null = null;

/**
 * Call once per cold start (from App.tsx, once the app is ready). Increments
 * and persists the session counter, and returns the new count plus whether
 * this is the very first session ever (useful to avoid showing "returning
 * user" content to a brand new install).
 */
export async function recordAppOpen(): Promise<{ sessionNumber: number; isFirstSession: boolean }> {
  try {
    const stored = await AsyncStorage.getItem(SESSION_COUNT_KEY);
    const previousCount = stored ? parseInt(stored, 10) || 0 : 0;
    const sessionNumber = previousCount + 1;

    await AsyncStorage.setItem(SESSION_COUNT_KEY, String(sessionNumber));
    await AsyncStorage.setItem(LAST_SESSION_AT_KEY, new Date().toISOString());

    cachedSessionNumber = sessionNumber;
    fullScreenPaywallShownThisSession = false;

    return { sessionNumber, isFirstSession: previousCount === 0 };
  } catch (error) {
    console.error("[Session] Failed to record app open:", error);
    // Fail open with session 1 semantics rather than crash startup.
    cachedSessionNumber = 1;
    return { sessionNumber: 1, isFirstSession: true };
  }
}

/**
 * Current session's number, if recordAppOpen() has already run this launch.
 * Returns null before the first call (e.g. very early in App.tsx render).
 */
export function getCurrentSessionNumber(): number | null {
  return cachedSessionNumber;
}

/**
 * True once any full-screen paywall (PaywallScreen) has been presented
 * during this app session. Callers should check this before navigating to
 * Paywall for a "soft"/optional placement (contextual hard gates on an
 * explicit user action are exempt - the user directly asked for a premium
 * action, so they must still see why it's blocked).
 */
export function hasShownFullScreenPaywallThisSession(): boolean {
  return fullScreenPaywallShownThisSession;
}

export function markFullScreenPaywallShown(): void {
  fullScreenPaywallShownThisSession = true;
}

/**
 * Cooldown gate for the returning-user prompt: at most once every 7 days.
 */
export async function canShowReturningUserPrompt(): Promise<boolean> {
  try {
    const lastShown = await AsyncStorage.getItem(LAST_RETURNING_USER_PROMPT_KEY);
    if (!lastShown) return true;

    const daysSince = (Date.now() - new Date(lastShown).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince >= 7;
  } catch (error) {
    console.error("[Session] Failed to check returning-user cooldown:", error);
    return false;
  }
}

export async function recordReturningUserPromptShown(): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_RETURNING_USER_PROMPT_KEY, new Date().toISOString());
  } catch (error) {
    console.error("[Session] Failed to record returning-user prompt:", error);
  }
}

// ============================================
// Per-session dismissal (promo cards, non-blocking prompts)
// ============================================

// In-memory only, keyed by an arbitrary string (typically a PaywallPlacement)
// - resets every cold start, which is exactly "dismissible for the current
// session": dismissing the weather promo card or trip dashboard card hides
// it until the app is relaunched, without persisting a permanent opt-out.
const dismissedThisSession = new Set<string>();

export function isDismissedThisSession(key: string): boolean {
  return dismissedThisSession.has(key);
}

export function dismissForSession(key: string): void {
  dismissedThisSession.add(key);
}
