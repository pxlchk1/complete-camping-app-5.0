/**
 * Paywall Placements
 *
 * Single source of truth for every paywall/subscription-prompt trigger in
 * the app. This is the TypeScript equivalent of the brief's Swift
 * `PaywallPlacement` enum - adapted to how this app already threads a
 * `triggerKey: string` through navigation params, PaywallScreen's content
 * map, and gate analytics (`trackGateImpression(gateKey)`), rather than
 * introducing a second, parallel identifier system.
 *
 * Every PaywallPlacement value IS the triggerKey passed to
 * `navigation.navigate("Paywall", { triggerKey: PaywallPlacement.X })`, so
 * placement, content lookup, and analytics all key off the same string.
 *
 * Existing screens that predate this registry still pass their own ad-hoc
 * triggerKey strings (e.g. "gear_closet_limit", "photo_limit") - those
 * continue to work unchanged via PaywallScreen's PAYWALL_CONTENT fallback.
 * This registry is where all *new* subscription-conversion work should
 * register its placements going forward.
 */

export enum PaywallPlacement {
  /** Shown once, after a user's first trip successfully saves. */
  FirstTripCompleted = "paywall_first_trip",
  /** Non-blocking promotional card near weather - weather itself stays free. */
  ExtendedWeather = "paywall_extended_weather",
  /** Sharing a trip / inviting or coordinating with camping companions. */
  ShareTrip = "paywall_share_trip",
  /** Creating/customizing a checklist beyond what the free tier allows. */
  AdditionalChecklist = "paywall_additional_checklist",
  /** Creating a 2nd+ trip (free tier is capped at one trip ever). */
  AdditionalTrip = "paywall_additional_trip",
  /** Soft re-engagement prompt for non-subscribers on a later session. */
  ReturningUser = "paywall_return_visit",
  /** Compact dismissible card on a free user's trip dashboard. */
  TripDashboard = "paywall_trip_dashboard",
}

export interface PaywallPlacementContent {
  title: string;
  body: string;
  /** True for placements that appear on an action the product already gates (hard block). False for purely promotional, non-blocking placements. */
  isHardGate: boolean;
}

/**
 * Content is a plain description of the feature the user was trying to
 * reach - no trial/price language here. Real intro-offer duration/price is
 * resolved at render time from StoreKit via getIntroOfferInfo(), never
 * hard-coded, since whether a trial exists (and its length) is entirely a
 * function of App Store Connect configuration.
 */
export const PAYWALL_PLACEMENT_CONTENT: Record<PaywallPlacement, PaywallPlacementContent> = {
  [PaywallPlacement.FirstTripCompleted]: {
    title: "Your trip is ready",
    body: "Unlock the full planning tools for this trip, including extended weather, packing tools, saved trip details, and crew coordination.",
    isHardGate: false,
  },
  [PaywallPlacement.ExtendedWeather]: {
    title: "Planning more trips?",
    body: "Premium keeps your trips, checklists, and camping crew organized in one place.",
    isHardGate: false,
  },
  [PaywallPlacement.ShareTrip]: {
    title: "Share this trip",
    body: "Share this trip with your camping crew - invite people, coordinate plans, and keep everyone on the same page.",
    isHardGate: true,
  },
  [PaywallPlacement.AdditionalChecklist]: {
    title: "Create another checklist",
    body: "Create another checklist for this trip, with full customization - add, remove, and reorder items your way.",
    isHardGate: true,
  },
  [PaywallPlacement.AdditionalTrip]: {
    title: "Plan another trip",
    body: "Unlock unlimited trips - keep planning every camping trip you take, not just your first.",
    isHardGate: true,
  },
  [PaywallPlacement.ReturningUser]: {
    title: "Welcome back",
    body: "You've been planning some great trips. Premium keeps every trip, checklist, and crew detail organized in one place.",
    isHardGate: false,
  },
  [PaywallPlacement.TripDashboard]: {
    title: "Unlock this trip",
    body: "Unlock extended weather, packing reminders, and shared trip planning for this trip.",
    isHardGate: false,
  },
};
