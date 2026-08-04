/**
 * Analytics Service
 * Centralized analytics tracking for activation + retention metrics
 *
 * Delivery:
 * - Web: Firebase Analytics web SDK (works natively there).
 * - iOS/Android: the Firebase Analytics *web* SDK does not work in React
 *   Native (it depends on DOM APIs), and this project cannot add a native
 *   analytics package (@react-native-firebase/analytics, Amplitude, etc.)
 *   without an install. So on native, events are written to a lightweight
 *   Firestore event log (`analyticsEvents` collection) using the Firestore
 *   client already used everywhere else in the app. This is a real,
 *   queryable delivery path (verifiable in the Firebase console), not a
 *   no-op - but it is not a full analytics platform. If/when a native SDK
 *   package is approved, swap NATIVE adapter below without touching call
 *   sites; every trackX() function in this file stays the same.
 *
 * No personal/sensitive data (trip names, exact locations, emails) should
 * ever be passed as an event property - use opaque IDs instead.
 */

import { Platform } from "react-native";
import Constants from "expo-constants";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../config/firebase";
import { getCurrentSessionNumber } from "./sessionService";

type Analytics = any;

const isWebEnvironment = Platform.OS === "web";
const appVersion = Constants.expoConfig?.version || "unknown";

// ============================================
// WEB ADAPTER (Firebase Analytics web SDK)
// ============================================

let webAnalyticsInstance: Analytics | null = null;
let webAnalyticsInitAttempted = false;

async function getWebAnalyticsInstance(): Promise<Analytics | null> {
  if (!isWebEnvironment) return null;
  if (webAnalyticsInitAttempted) return webAnalyticsInstance;
  webAnalyticsInitAttempted = true;

  try {
    const { getAnalytics, isSupported } = await import("firebase/analytics");
    const { default: firebaseApp } = await import("../config/firebase");
    if (await isSupported()) {
      webAnalyticsInstance = getAnalytics(firebaseApp);
    }
  } catch {
    console.log("[Analytics] Firebase Analytics (web) not available");
  }
  return webAnalyticsInstance;
}

async function logToWeb(eventName: string, params: Record<string, any>): Promise<void> {
  const instance = await getWebAnalyticsInstance();
  if (!instance) return;
  try {
    const { logEvent } = await import("firebase/analytics");
    logEvent(instance, eventName, params);
  } catch (error) {
    console.error(`[Analytics] Web delivery failed for ${eventName}:`, error);
  }
}

// ============================================
// NATIVE ADAPTER (Firestore event log)
// ============================================

const NATIVE_EVENTS_COLLECTION = "analyticsEvents";

async function logToNative(eventName: string, params: Record<string, any>): Promise<void> {
  try {
    await addDoc(collection(db, NATIVE_EVENTS_COLLECTION), {
      event: eventName,
      params,
      platform: Platform.OS,
      appVersion,
      userId: auth.currentUser?.uid || null,
      sessionNumber: getCurrentSessionNumber(),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.error(`[Analytics] Native delivery failed for ${eventName}:`, error);
  }
}

// ============================================
// CORE LOGGING (used by every trackX function)
// ============================================

async function logAnalyticsEvent(eventName: string, params?: Record<string, any>): Promise<void> {
  const fullParams = { ...params, timestamp: new Date().toISOString() };

  if (__DEV__) {
    console.debug(`[Analytics] ${eventName}`, fullParams);
  }

  if (isWebEnvironment) {
    await logToWeb(eventName, fullParams);
  } else {
    await logToNative(eventName, fullParams);
  }
}

// ============================================
// CORE EVENT NAMES
// ============================================

export const AnalyticsEvents = {
  // App lifecycle / sessions
  APP_OPEN: "app_opened",
  SESSION_START: "session_started",

  // Onboarding
  ONBOARDING_STARTED: "onboarding_started",
  ONBOARDING_COMPLETED: "onboarding_completed",

  // Push permission
  PERMISSION_PROMPT_SHOWN: "permission_prompt_shown",
  PERMISSION_RESULT: "permission_result",

  // Notifications
  PUSH_SENT: "push_sent",
  PUSH_OPENED: "push_opened",
  EMAIL_SENT: "email_sent",
  EMAIL_CLICKED: "email_clicked",

  // Core actions
  TRIP_CREATED: "trip_created",
  TRIP_OPENED: "trip_opened",
  PACKINGLIST_GENERATED: "packinglist_generated",
  GEAR_ITEM_ADDED: "gear_item_added",
  SAVED_PLACE_ADDED: "saved_place_added",
  WEATHER_ADDED_TO_TRIP: "weather_added_to_trip",
  BUDDY_INVITE_SENT: "buddy_invite_sent",

  // Engagement
  RETURN_DAY_7: "return_day_7",

  // Gating & Monetization
  PAYWALL_DISMISSED: "paywall_dismissed",
  ACCOUNT_REQUIRED_SHOWN: "account_required_shown",
  ACCOUNT_REQUIRED_CTA_TAPPED: "account_required_cta_tapped",
  ACCOUNT_REQUIRED_DISMISSED: "account_required_dismissed",
  PRO_ATTEMPT_GATE: "pro_attempt_gate",

  // Welcome Modals
  MY_CAMPSITE_WELCOME_SHOWN: "my_campsite_welcome_shown",
  MY_CAMPSITE_WELCOME_PRIMARY_CTA_TAPPED: "my_campsite_welcome_primary_cta_tapped",
  MY_CAMPSITE_WELCOME_DISMISSED: "my_campsite_welcome_dismissed",

  // Upsell Modals (Trial prompts)
  UPSELL_MODAL_VIEWED: "upsell_modal_viewed",
  UPSELL_MODAL_DISMISSED: "upsell_modal_dismissed",
  UPSELL_CTA_CLICKED: "upsell_cta_clicked",
  TRIP2_GATE_VIEWED: "trip2_gate_viewed",
  TRIP2_GATE_DISMISSED: "trip2_gate_dismissed",

  // Subscription conversion funnel (new)
  SUBSCRIPTION_STATUS_CHECKED: "subscription_status_checked",
  PAYWALL_VIEWED: "paywall_viewed",
  SUBSCRIPTION_PLAN_SELECTED: "subscription_plan_selected",
  SUBSCRIPTION_PURCHASE_STARTED: "subscription_purchase_started",
  SUBSCRIPTION_PURCHASE_COMPLETED: "subscription_purchase_completed",
  SUBSCRIPTION_PURCHASE_FAILED: "subscription_purchase_failed",
  SUBSCRIPTION_RESTORED: "subscription_restored",
  INTRO_OFFER_DISPLAYED: "intro_offer_displayed",
  INTRO_OFFER_STARTED: "intro_offer_started",

  // Purchases (legacy)
  PURCHASE_COMPLETED: "purchase_completed",
  PURCHASE_STARTED: "purchase_started",
  PURCHASE_FAILED: "purchase_failed",
} as const;

export type OnboardingCompletionReason = "2_core_actions" | "day_30" | "opted_out";
export type PermissionType = "push";
export type PermissionStatus = "granted" | "denied" | "undetermined";

/**
 * Properties every new subscription-funnel event may carry. Every field is
 * either an opaque ID, a category, or a number - never a trip name, address,
 * or other personal detail.
 */
export interface SubscriptionEventProps {
  placement?: string;
  product_id?: string;
  plan_type?: "monthly" | "annual";
  trip_id?: string;
  days_until_trip?: number;
  session_number?: number;
  intro_offer_eligible?: boolean;
  purchase_error?: string;
}

// ============================================
// ANALYTICS SERVICE
// ============================================

class AnalyticsService {
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    try {
      this.isInitialized = true;
      console.log("[Analytics] Initialized");
    } catch (error) {
      console.error("[Analytics] Failed to initialize:", error);
    }
  }

  async setAnalyticsUserId(userId: string | null): Promise<void> {
    if (!isWebEnvironment) return; // native events already tag userId per-event
    const instance = await getWebAnalyticsInstance();
    if (!instance) return;
    try {
      const { setUserId } = await import("firebase/analytics");
      if (userId) setUserId(instance, userId);
    } catch (error) {
      console.error("[Analytics] Failed to set user ID:", error);
    }
  }

  async setUserProperty(name: string, value: string | null): Promise<void> {
    if (!isWebEnvironment) return;
    const instance = await getWebAnalyticsInstance();
    if (!instance) return;
    try {
      const { setUserProperties } = await import("firebase/analytics");
      setUserProperties(instance, { [name]: value });
    } catch (error) {
      console.error("[Analytics] Failed to set user property:", error);
    }
  }

  // App lifecycle
  async trackAppOpen(): Promise<void> {
    await logAnalyticsEvent(AnalyticsEvents.APP_OPEN);
  }

  async trackSessionStarted(sessionNumber: number): Promise<void> {
    await logAnalyticsEvent(AnalyticsEvents.SESSION_START, { session_number: sessionNumber });
  }

  // Onboarding
  async trackOnboardingStarted(): Promise<void> {
    await logAnalyticsEvent(AnalyticsEvents.ONBOARDING_STARTED);
  }

  async trackOnboardingCompleted(reason: OnboardingCompletionReason): Promise<void> {
    await logAnalyticsEvent(AnalyticsEvents.ONBOARDING_COMPLETED, { reason });
  }

  // Permissions
  async trackPermissionPromptShown(type: PermissionType): Promise<void> {
    await logAnalyticsEvent(AnalyticsEvents.PERMISSION_PROMPT_SHOWN, { type });
  }

  async trackPermissionResult(type: PermissionType, status: PermissionStatus): Promise<void> {
    await logAnalyticsEvent(AnalyticsEvents.PERMISSION_RESULT, { type, status });
  }

  // Notifications
  async trackPushSent(key: string): Promise<void> {
    await logAnalyticsEvent(AnalyticsEvents.PUSH_SENT, { key });
  }

  async trackPushOpened(key: string): Promise<void> {
    await logAnalyticsEvent(AnalyticsEvents.PUSH_OPENED, { key });
  }

  async trackEmailSent(key: string): Promise<void> {
    await logAnalyticsEvent(AnalyticsEvents.EMAIL_SENT, { key });
  }

  async trackEmailClicked(key: string): Promise<void> {
    await logAnalyticsEvent(AnalyticsEvents.EMAIL_CLICKED, { key });
  }

  // Core actions
  async trackTripCreated(tripId?: string): Promise<void> {
    await logAnalyticsEvent(AnalyticsEvents.TRIP_CREATED, { trip_id: tripId });
  }

  async trackTripOpened(tripId?: string, daysUntilTrip?: number): Promise<void> {
    await logAnalyticsEvent(AnalyticsEvents.TRIP_OPENED, { trip_id: tripId, days_until_trip: daysUntilTrip });
  }

  async trackPackingListGenerated(tripId?: string): Promise<void> {
    await logAnalyticsEvent(AnalyticsEvents.PACKINGLIST_GENERATED, { trip_id: tripId });
  }

  async trackGearItemAdded(itemCount?: number): Promise<void> {
    await logAnalyticsEvent(AnalyticsEvents.GEAR_ITEM_ADDED, { item_count: itemCount });
  }

  async trackSavedPlaceAdded(placeType?: string): Promise<void> {
    await logAnalyticsEvent(AnalyticsEvents.SAVED_PLACE_ADDED, { place_type: placeType });
  }

  async trackWeatherAddedToTrip(tripId?: string): Promise<void> {
    await logAnalyticsEvent(AnalyticsEvents.WEATHER_ADDED_TO_TRIP, { trip_id: tripId });
  }

  async trackBuddyInviteSent(method?: "email" | "text" | "copy"): Promise<void> {
    await logAnalyticsEvent(AnalyticsEvents.BUDDY_INVITE_SENT, { method });
  }

  // Engagement
  async trackReturnDay7(): Promise<void> {
    await logAnalyticsEvent(AnalyticsEvents.RETURN_DAY_7);
  }

  // Generic
  async trackEvent(eventName: string, params?: Record<string, any>): Promise<void> {
    await logAnalyticsEvent(eventName, params);
  }
}

export const analyticsService = new AnalyticsService();

// ============================================
// CONVENIENCE EXPORTS (existing - unchanged signatures)
// ============================================

export const trackAppOpen = () => analyticsService.trackAppOpen();
export const trackSessionStarted = (sessionNumber: number) => analyticsService.trackSessionStarted(sessionNumber);
export const trackOnboardingStarted = () => analyticsService.trackOnboardingStarted();
export const trackOnboardingCompleted = (reason: OnboardingCompletionReason) => analyticsService.trackOnboardingCompleted(reason);
export const trackPermissionPromptShown = (type: PermissionType) => analyticsService.trackPermissionPromptShown(type);
export const trackPermissionResult = (type: PermissionType, status: PermissionStatus) => analyticsService.trackPermissionResult(type, status);
export const trackPushSent = (key: string) => analyticsService.trackPushSent(key);
export const trackPushOpened = (key: string) => analyticsService.trackPushOpened(key);
export const trackEmailSent = (key: string) => analyticsService.trackEmailSent(key);
export const trackEmailClicked = (key: string) => analyticsService.trackEmailClicked(key);
export const trackTripCreated = (tripId?: string) => analyticsService.trackTripCreated(tripId);
export const trackTripOpened = (tripId?: string, daysUntilTrip?: number) => analyticsService.trackTripOpened(tripId, daysUntilTrip);
export const trackPackingListGenerated = (tripId?: string) => analyticsService.trackPackingListGenerated(tripId);
export const trackGearItemAdded = (itemCount?: number) => analyticsService.trackGearItemAdded(itemCount);
export const trackSavedPlaceAdded = (placeType?: string) => analyticsService.trackSavedPlaceAdded(placeType);
export const trackWeatherAddedToTrip = (tripId?: string) => analyticsService.trackWeatherAddedToTrip(tripId);
export const trackBuddyInviteSent = (method?: "email" | "text" | "copy") => analyticsService.trackBuddyInviteSent(method);
export const trackReturnDay7 = () => analyticsService.trackReturnDay7();

// Gating & Monetization
export const trackAccountRequiredShown = (triggerKey: string) =>
  analyticsService.trackEvent(AnalyticsEvents.ACCOUNT_REQUIRED_SHOWN, { trigger_key: triggerKey });
export const trackAccountRequiredCtaTapped = (triggerKey: string) =>
  analyticsService.trackEvent(AnalyticsEvents.ACCOUNT_REQUIRED_CTA_TAPPED, { trigger_key: triggerKey });
export const trackAccountRequiredDismissed = (triggerKey: string) =>
  analyticsService.trackEvent(AnalyticsEvents.ACCOUNT_REQUIRED_DISMISSED, { trigger_key: triggerKey });
export const trackProAttemptGate = (gateKey: string, attemptCount: number) =>
  analyticsService.trackEvent(AnalyticsEvents.PRO_ATTEMPT_GATE, { gate_key: gateKey, attempt_count: attemptCount });

// Welcome modal (legacy - unchanged)
export const trackMyCampsiteWelcomeShown = () =>
  analyticsService.trackEvent(AnalyticsEvents.MY_CAMPSITE_WELCOME_SHOWN);
export const trackMyCampsiteWelcomeCtaTapped = () =>
  analyticsService.trackEvent(AnalyticsEvents.MY_CAMPSITE_WELCOME_PRIMARY_CTA_TAPPED);
export const trackMyCampsiteWelcomeDismissed = () =>
  analyticsService.trackEvent(AnalyticsEvents.MY_CAMPSITE_WELCOME_DISMISSED);

// Upsell modal (legacy - unchanged)
export type UpsellModalAnalyticsType = "completion" | "packing" | "invite" | "trip2_gate" | "badge_earned" | "learning_complete" | "returning_user";

export const trackUpsellModalViewed = (type: UpsellModalAnalyticsType) =>
  analyticsService.trackEvent(AnalyticsEvents.UPSELL_MODAL_VIEWED, { type });
export const trackUpsellModalDismissed = (type: UpsellModalAnalyticsType) =>
  analyticsService.trackEvent(AnalyticsEvents.UPSELL_MODAL_DISMISSED, { type });
export const trackUpsellCtaClicked = (type: UpsellModalAnalyticsType) =>
  analyticsService.trackEvent(AnalyticsEvents.UPSELL_CTA_CLICKED, { type });
export const trackTrip2GateViewed = () =>
  analyticsService.trackEvent(AnalyticsEvents.TRIP2_GATE_VIEWED);
export const trackTrip2GateDismissed = () =>
  analyticsService.trackEvent(AnalyticsEvents.TRIP2_GATE_DISMISSED);

// Purchase (legacy - unchanged)
export const trackPurchaseCompleted = (plan: string) =>
  analyticsService.trackEvent(AnalyticsEvents.PURCHASE_COMPLETED, { plan });

// ============================================
// NEW: Subscription conversion funnel events
// ============================================

export const trackSubscriptionStatusChecked = (props: SubscriptionEventProps) =>
  analyticsService.trackEvent(AnalyticsEvents.SUBSCRIPTION_STATUS_CHECKED, props);

export const trackPaywallViewed = (props: SubscriptionEventProps) =>
  analyticsService.trackEvent(AnalyticsEvents.PAYWALL_VIEWED, props);

export const trackPaywallDismissed = (props: SubscriptionEventProps) =>
  analyticsService.trackEvent(AnalyticsEvents.PAYWALL_DISMISSED, props);

export const trackSubscriptionPlanSelected = (props: SubscriptionEventProps) =>
  analyticsService.trackEvent(AnalyticsEvents.SUBSCRIPTION_PLAN_SELECTED, props);

export const trackSubscriptionPurchaseStarted = (props: SubscriptionEventProps) =>
  analyticsService.trackEvent(AnalyticsEvents.SUBSCRIPTION_PURCHASE_STARTED, props);

export const trackSubscriptionPurchaseCompleted = (props: SubscriptionEventProps) =>
  analyticsService.trackEvent(AnalyticsEvents.SUBSCRIPTION_PURCHASE_COMPLETED, props);

export const trackSubscriptionPurchaseFailed = (props: SubscriptionEventProps) =>
  analyticsService.trackEvent(AnalyticsEvents.SUBSCRIPTION_PURCHASE_FAILED, props);

export const trackSubscriptionRestored = (props: SubscriptionEventProps) =>
  analyticsService.trackEvent(AnalyticsEvents.SUBSCRIPTION_RESTORED, props);

export const trackIntroOfferDisplayed = (props: SubscriptionEventProps) =>
  analyticsService.trackEvent(AnalyticsEvents.INTRO_OFFER_DISPLAYED, props);

export const trackIntroOfferStarted = (props: SubscriptionEventProps) =>
  analyticsService.trackEvent(AnalyticsEvents.INTRO_OFFER_STARTED, props);
