/**
 * Subscription Service
 * High-level service for managing subscriptions throughout the app
 */

import Purchases, { PurchasesPackage } from "react-native-purchases";
import * as RevenueCat from "../lib/revenuecatClient";
import { useSubscriptionStore } from "../state/subscriptionStore";
import { useAuthStore } from "../state/authStore";
import { auth, db } from "../config/firebase";
import { doc, updateDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { SUBSCRIPTIONS_ENABLED } from "../config/subscriptions";
import { trackSubscriptionStatusChecked } from "./analyticsService";
import { getCurrentSessionNumber } from "./sessionService";

export interface IntroOfferInfo {
  /** Whether StoreKit confirms THIS user can still redeem it (not just that the product has one configured). */
  eligible: boolean;
  /** True when the intro price is $0 (a genuine free trial) rather than a discounted intro price. */
  isFreeTrial: boolean;
  /** Human-readable intro duration, e.g. "3 days", "1 week", "1 month". */
  durationLabel: string;
  /** Human-readable intro price, e.g. "Free" or "$1.99". */
  priceLabel: string;
  /** The regular price the plan renews at after the intro period ends. */
  renewalPriceLabel: string;
}

const PERIOD_UNIT_LABELS: Record<string, string> = {
  DAY: "day",
  WEEK: "week",
  MONTH: "month",
  YEAR: "year",
};

function formatIntroPeriod(periodNumberOfUnits: number, periodUnit: string, cycles: number): string {
  const unitLabel = PERIOD_UNIT_LABELS[periodUnit] || periodUnit.toLowerCase();
  const totalUnits = Math.max(1, periodNumberOfUnits) * Math.max(1, cycles);
  return `${totalUnits} ${unitLabel}${totalUnits === 1 ? "" : "s"}`;
}

/**
 * Real (not hard-coded) introductory-offer info for a package: whether one
 * exists at all, whether StoreKit confirms this specific user is eligible
 * for it, and its actual duration/price as configured in App Store Connect.
 * Returns null when the product has no intro offer configured - callers
 * must never invent trial copy in that case.
 */
export async function getIntroOfferInfo(pkg: PurchasesPackage): Promise<IntroOfferInfo | null> {
  const introPrice = pkg.product.introPrice;
  if (!introPrice) return null;

  const eligibilityMap = await RevenueCat.checkIntroEligibility([pkg.product.identifier]);
  const eligible = eligibilityMap[pkg.product.identifier] ?? false;

  return {
    eligible,
    isFreeTrial: introPrice.price === 0,
    durationLabel: formatIntroPeriod(introPrice.periodNumberOfUnits, introPrice.periodUnit, introPrice.cycles),
    priceLabel: introPrice.price === 0 ? "Free" : introPrice.priceString,
    renewalPriceLabel: pkg.product.priceString,
  };
}

/**
 * Safely fetch offerings with proper error handling
 * Returns null if offerings are unavailable or misconfigured
 * Products: cca_monthly_sub ($6.99), cca_annual_sub ($39.99)
 * Entitlement: "Pro" (case-sensitive)
 */
export async function fetchOfferingsSafe() {
  if (!SUBSCRIPTIONS_ENABLED) {
    console.log("[SubscriptionService] Subscriptions disabled via feature flag");
    return null;
  }

  if (!RevenueCat.isRevenueCatReady()) {
    console.warn("[SubscriptionService] RevenueCat not ready");
    return null;
  }

  try {
    const offerings = await Purchases.getOfferings();

    // Detailed logging for troubleshooting Apple product availability
    console.log("[SubscriptionService] Offerings response:", {
      currentOffering: offerings.current?.identifier || "none",
      allOfferingsCount: Object.keys(offerings.all).length,
      packagesInCurrent: offerings.current?.availablePackages.length || 0,
    });

    if (!offerings.current) {
      console.warn("[SubscriptionService] No current offering - check RevenueCat dashboard offering configuration");
      return null;
    }

    if (!offerings.current.availablePackages.length) {
      console.warn("[SubscriptionService] No packages in current offering", {
        offeringId: offerings.current.identifier,
        possibleCauses: [
          "Products 'Waiting for Review' in App Store Connect",
          "Products not available in tester's storefront country (check availability: should be more than 1/175 countries)",
          "Products not linked to offering in RevenueCat",
          "Subscription group not configured correctly",
        ],
      });
      return null;
    }

    // Log available packages for debugging
    offerings.current.availablePackages.forEach((pkg) => {
      console.log("[SubscriptionService] Package available:", {
        identifier: pkg.identifier,
        productId: pkg.product.identifier,
        price: pkg.product.priceString,
        period: pkg.packageType,
      });
    });

    console.log("[SubscriptionService] Offerings loaded successfully:", offerings.current.availablePackages.length, "packages");
    return offerings;
  } catch (error: any) {
    console.error("[SubscriptionService] Error fetching offerings:", {
      message: error.message,
      code: error.code,
      underlyingErrorMessage: error.underlyingErrorMessage,
    });
    return null;
  }
}

/**
 * Initialize the subscription system
 * Call this once when the app starts, BEFORE auth state is known
 */
export const initSubscriptions = async (): Promise<void> => {
  if (!SUBSCRIPTIONS_ENABLED) {
    console.log("[SubscriptionService] Subscriptions disabled via feature flag");
    return;
  }

  try {
    console.log("[SubscriptionService] Initializing subscriptions (anonymous)");

    // Initialize RevenueCat SDK anonymously (no user ID yet)
    const initialized = await RevenueCat.initRevenueCat();

    if (!initialized) {
      console.log("[SubscriptionService] RevenueCat not available on this platform");
      return;
    }

    // Register CustomerInfo listener for automatic updates
    RevenueCat.addCustomerInfoListener((customerInfo) => {
      console.log("[SubscriptionService] CustomerInfo updated:", {
        entitlements: Object.keys(customerInfo.entitlements.active),
        originalAppUserId: customerInfo.originalAppUserId,
      });
      
      // Update subscription store
      useSubscriptionStore.getState().setSubscriptionInfo(customerInfo);
      
      // Sync to Firestore if user is logged in
      syncSubscriptionToFirestore().catch((error) => {
        console.error("[SubscriptionService] Failed to sync after listener update:", error);
      });
    });

    console.log("[SubscriptionService] Subscriptions initialized successfully");
  } catch (error) {
    console.error("[SubscriptionService] Failed to initialize subscriptions:", error);
  }
};

/**
 * Identify user in RevenueCat with Firebase uid
 * Call this when Firebase auth state changes to signed in
 */
export const identifyUser = async (firebaseUid: string): Promise<void> => {
  if (!SUBSCRIPTIONS_ENABLED) {
    return;
  }

  try {
    console.log("[SubscriptionService] Identifying user with Firebase uid:", firebaseUid);
    await RevenueCat.identifyUser(firebaseUid);
    
    // Refresh entitlements after identification
    const customerInfo = await RevenueCat.getCustomerInfo();
    if (customerInfo) {
      useSubscriptionStore.getState().setSubscriptionInfo(customerInfo);
      await syncSubscriptionToFirestore();
    }
    
    console.log("[SubscriptionService] User identified and entitlements refreshed");
  } catch (error) {
    console.error("[SubscriptionService] Failed to identify user:", error);
    throw error;
  }
};

/**
 * Get current customer info
 */
export const getCurrentCustomerInfo = async () => {
  return await RevenueCat.getCustomerInfo();
};

/**
 * Subscribe to a plan
 */
export const subscribeToPlan = async (packageIdentifier: string): Promise<boolean> => {
  const { setLoading, setError, setSubscriptionInfo } = useSubscriptionStore.getState();

  try {
    setLoading(true);
    setError(null);

    // Get the package
    const pkg = await RevenueCat.getPackage(packageIdentifier);
    if (!pkg) {
      throw new Error("Package not found");
    }

    // Purchase the package
    const customerInfo = await RevenueCat.purchasePackage(pkg);

    if (customerInfo) {
      // Update store with new subscription info
      setSubscriptionInfo(customerInfo);
      return true;
    }

    return false; // User cancelled
  } catch (error: any) {
    console.error("[SubscriptionService] Purchase failed:", error);
    setError(error.message || "Purchase failed");
    throw error;
  } finally {
    setLoading(false);
  }
};

/**
 * Restore purchases
 */
export const restorePurchases = async (): Promise<boolean> => {
  const { setLoading, setError, setSubscriptionInfo } = useSubscriptionStore.getState();

  try {
    setLoading(true);
    setError(null);

    const customerInfo = await RevenueCat.restorePurchases();

    if (customerInfo) {
      setSubscriptionInfo(customerInfo);

      // Check if any entitlements were restored
      const hasEntitlements = Object.keys(customerInfo.entitlements.active).length > 0;
      return hasEntitlements;
    }

    return false;
  } catch (error: any) {
    console.error("[SubscriptionService] Restore failed:", error);
    setError(error.message || "Failed to restore purchases");
    throw error;
  } finally {
    setLoading(false);
  }
};

/**
 * Refresh entitlements from RevenueCat
 */
export const refreshEntitlements = async (): Promise<void> => {
  const { setLoading, setSubscriptionInfo } = useSubscriptionStore.getState();

  try {
    setLoading(true);

    const customerInfo = await RevenueCat.getCustomerInfo();
    setSubscriptionInfo(customerInfo);
    trackSubscriptionStatusChecked({ session_number: getCurrentSessionNumber() ?? undefined });
  } catch (error) {
    console.error("[SubscriptionService] Failed to refresh entitlements:", error);
  } finally {
    setLoading(false);
  }
};

/**
 * Log out user from RevenueCat
 */
export const logOutSubscriptions = async (): Promise<void> => {
  try {
    await RevenueCat.logOut();
    useSubscriptionStore.getState().clearSubscription();
  } catch (error) {
    console.error("[SubscriptionService] Failed to log out:", error);
  }
};

/**
 * Get available offerings (DEPRECATED - use fetchOfferingsSafe instead)
 */
export const getOfferings = async () => {
  console.warn("[SubscriptionService] getOfferings is deprecated, use fetchOfferingsSafe instead");
  const offerings = await fetchOfferingsSafe();
  return offerings?.current || null;
};

/**
 * Sync RevenueCat subscription status to Firestore users/{uid}
 * Maps entitlement "Pro" to membership tiers and subscription status
 * Only writes to Firestore when values change to minimize updates
 */
export const syncSubscriptionToFirestore = async (): Promise<void> => {
  const user = auth.currentUser;
  if (!user) {
    console.log("[SubscriptionService] No user logged in, skipping Firestore sync");
    return;
  }

  try {
    const customerInfo = await RevenueCat.getCustomerInfo();
    if (!customerInfo) {
      console.log("[SubscriptionService] No customer info available");
      return;
    }

    // Check for exact entitlement "Pro" (case-sensitive)
    const hasPro = Boolean(customerInfo.entitlements.active["Pro"]);
    const activeEntitlements = Object.keys(customerInfo.entitlements.active);
    
    // Determine membership tier and subscription status
    let membershipTier = "freeMember";
    let subscriptionStatus: "active" | "expired" | "canceled" | "none" = "none";

    if (hasPro) {
      // User has active Pro entitlement
      membershipTier = "subscribed";
      subscriptionStatus = "active";
    } else {
      // Check if subscription existed but is now expired/canceled
      const allEntitlements = customerInfo.entitlements.all;
      const proEntitlement = allEntitlements["Pro"];
      
      if (proEntitlement) {
        const expirationDate = proEntitlement.expirationDate;
        if (expirationDate) {
          const isExpired = new Date(expirationDate) < new Date();
          subscriptionStatus = isExpired ? "expired" : "canceled";
        } else {
          subscriptionStatus = "expired";
        }
      }
    }

    // Get current Firestore data to check if update is needed
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    const currentData = userSnap.data();

    // Only write if values changed
    const needsUpdate = 
      currentData?.membershipTier !== membershipTier ||
      currentData?.subscriptionStatus !== subscriptionStatus ||
      JSON.stringify(currentData?.entitlements || []) !== JSON.stringify(activeEntitlements);

    if (!needsUpdate) {
      console.log("[SubscriptionService] Firestore already up to date, skipping write");
      return;
    }

    // Update Firestore with new subscription data
    await updateDoc(userRef, {
      membershipTier,
      subscriptionProvider: "revenuecat",
      subscriptionStatus,
      entitlements: activeEntitlements,
      subscriptionUpdatedAt: serverTimestamp(),
    });

    console.log("[SubscriptionService] Synced to Firestore:", {
      membershipTier,
      subscriptionStatus,
      entitlements: activeEntitlements,
      originalAppUserId: customerInfo.originalAppUserId,
    });
  } catch (error) {
    console.error("[SubscriptionService] Failed to sync to Firestore:", error);
    // Don't throw - this is a background sync operation
  }
};

