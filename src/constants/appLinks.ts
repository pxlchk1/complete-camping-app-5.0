/**
 * App Links Configuration
 * Central location for all app store and deep links
 */

// App Store Links
export const APP_STORE_ID = "6752673528";
export const APP_STORE_SKU = "TLCAMP001";
export const APP_STORE_LINK = `https://apps.apple.com/app/id${APP_STORE_ID}`;

// Google Play Links (for future Android support)
export const PLAY_STORE_PACKAGE = "com.tentandlantern.completecampingapp";
export const PLAY_STORE_LINK = `https://play.google.com/store/apps/details?id=${PLAY_STORE_PACKAGE}`;

// Deep Link Domain
// Must match app.json's ios.associatedDomains / android.intentFilters
// exactly, or the OS never hands these URLs to the app at all - it was
// previously set to tentandlantern.com, which isn't registered as an
// associated domain anywhere, so invite links silently never opened the
// app no matter how correct the in-app routing (App.tsx linking config)
// was.
export const DEEP_LINK_DOMAIN = "tentlantern.app";

// Invite Link Base URL
export const INVITE_LINK_BASE = `https://${DEEP_LINK_DOMAIN}/join`;

/**
 * Generate the full invite link from a token
 */
export function getInviteLinkUrl(token: string): string {
  return `${INVITE_LINK_BASE}?token=${token}`;
}

/**
 * Get the App Store download link
 */
export function getAppDownloadLink(): string {
  return APP_STORE_LINK;
}

/**
 * Check if the app is published to the App Store
 */
export function isAppPublished(): boolean {
  return true; // App ID: 6752673528
}

// App info for sharing
export const APP_NAME = "The Complete Camping App";
export const APP_SHORT_NAME = "Tent & Lantern";

/**
 * Generate invite share message with a real tappable deep link, plus the
 * App Store link and a manual code as fallbacks for anyone who doesn't
 * have the app yet or taps from a context that won't open it directly.
 */
export function generateShareInviteMessage(inviterFirstName: string, inviteToken: string): string {
  const inviteLink = getInviteLinkUrl(inviteToken);
  return `${inviterFirstName} invited you to join their campground on ${APP_NAME}! 🏕️\n\nAccept here: ${inviteLink}\n\nDon't have the app yet? Get it here: ${APP_STORE_LINK}\nThen use invite code: ${inviteToken.substring(0, 8)}`;
}

/**
 * Generate the copyable invite link text
 */
export function getCopyableInviteText(inviterFirstName: string, inviteToken: string): string {
  const inviteLink = getInviteLinkUrl(inviteToken);
  return `${inviterFirstName} wants you to join their campground on ${APP_NAME}! 🏕️\n\nAccept here: ${inviteLink}\n\nDon't have the app yet? Get it here: ${APP_STORE_LINK}\nThen use invite code: ${inviteToken.substring(0, 8)}`;
}

// Trip Share Invite Link Base URL - same pattern as campground invites,
// separate path so redeemTripShareInvite (not redeemCampgroundInvite)
// handles it.
export const TRIP_SHARE_LINK_BASE = `https://${DEEP_LINK_DOMAIN}/trip-invite`;

/**
 * Generate the full trip share invite link from a token
 */
export function getTripShareInviteLinkUrl(token: string): string {
  return `${TRIP_SHARE_LINK_BASE}?token=${token}`;
}

/**
 * Generate the copyable trip share invite text, with a real tappable link
 */
export function getCopyableTripShareInviteText(
  inviterFirstName: string,
  tripName: string,
  inviteToken: string,
  permission: "view" | "edit"
): string {
  const permissionLabel = permission === "edit" ? "plan and edit" : "view";
  const inviteLink = getTripShareInviteLinkUrl(inviteToken);
  return `${inviterFirstName} invited you to ${permissionLabel} their trip "${tripName}" on ${APP_NAME}! 🏕️\n\nAccept here: ${inviteLink}\n\nDon't have the app yet? Get it here: ${APP_STORE_LINK}\nThen use invite code: ${inviteToken.substring(0, 8)}`;
}
