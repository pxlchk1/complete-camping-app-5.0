/**
 * useNotifications Hook
 * Handles notification setup, listeners, and navigation
 */

import { useEffect, useRef, useCallback } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { auth } from "../config/firebase";
import {
  registerPushToken,
  addNotificationReceivedListener,
  addNotificationResponseListener,
  getInitialNotification,
  clearBadge,
} from "../services/notificationService";

type NotificationData = {
  type?: string;
  tripId?: string;
  parkId?: string;
  contentId?: string;
  [key: string]: any;
};

// Navigation function type that can be passed in
type NavigateFunction = (screen: string, params?: Record<string, any>) => void;

/**
 * Onboarding-nudge notifications (functions/src/index.ts) carry a `deepLink`
 * in the custom "cta://path/subpath" scheme rather than a real screen name.
 * Map each known path to an actual navigable route. Screens that only make
 * sense with a tripId we don't have (packing list, meal planning) fall back
 * to the Plan tab so the user can pick a trip themselves.
 */
function navigateToCtaDeepLink(navigateFn: NavigateFunction, deepLink: string) {
  const path = deepLink.replace(/^cta:\/\//, "").replace(/\/$/, "");

  // Dynamic-segment paths (social notifications carry the id in the link
  // itself, since the push payload only ever forwards {deepLink, type} -
  // see sendQueuedNotifications in functions/src/index.ts).
  const tripMatch = path.match(/^trip\/([^/]+)$/);
  if (tripMatch) {
    navigateFn("TripDetail", { tripId: tripMatch[1] });
    return;
  }

  const questionMatch = path.match(/^question\/([^/]+)$/);
  if (questionMatch) {
    navigateFn("QuestionDetail", { questionId: questionMatch[1] });
    return;
  }

  const tipMatch = path.match(/^tip\/([^/]+)$/);
  if (tipMatch) {
    navigateFn("TipDetail", { tipId: tipMatch[1] });
    return;
  }

  const feedbackMatch = path.match(/^feedback\/([^/]+)$/);
  if (feedbackMatch) {
    navigateFn("FeedbackDetail", { postId: feedbackMatch[1] });
    return;
  }

  const photoMatch = path.match(/^photo\/([^/]+)$/);
  if (photoMatch) {
    navigateFn("PhotoDetail", { storyId: photoMatch[1] });
    return;
  }

  const gearReviewMatch = path.match(/^gearreview\/([^/]+)$/);
  if (gearReviewMatch) {
    navigateFn("GearReviewDetail", { reviewId: gearReviewMatch[1] });
    return;
  }

  switch (path) {
    case "plan/new":
      navigateFn("CreateTrip");
      break;
    case "parks":
      navigateFn("ParksBrowse");
      break;
    case "gearcloset":
      navigateFn("MyGearCloset");
      break;
    case "weather":
      navigateFn("HomeTabs", {
        screen: "Plan",
        params: { screen: "MyTrips", params: { screen: "Weather" } },
      });
      break;
    case "profile/edit":
      navigateFn("EditProfile");
      break;
    case "campground/invite":
      navigateFn("MyCampground");
      break;
    case "community":
      navigateFn("HomeTabs", { screen: "Connect" });
      break;
    case "plan":
    case "packinglist/start":
    case "packinglist/categories":
    case "packinglist/save-template":
    case "meals":
      navigateFn("HomeTabs", { screen: "Plan" });
      break;
    default:
      navigateFn("HomeTabs");
  }
}

/**
 * Hook to manage notification listeners and handle notification responses
 * Should be used in the root App component
 */
export function useNotificationListeners(
  navigateFn?: NavigateFunction
) {
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);

  const handleNotificationResponse = useCallback((
    response: Notifications.NotificationResponse
  ) => {
    const data = response.notification.request.content.data as NotificationData;

    if (!data?.type || !navigateFn) {
      return;
    }

    // Navigate based on notification type
    switch (data.type) {
      // Client-originated trip types
      case "trip_reminder":
      case "packing_reminder":
      case "arrival_day":
      case "trip_ending":
      case "post_trip_recap":
      // Server-queued trip types
      case "trip_starts_3_days":
      case "trip_starts_tomorrow":
      case "trip_no_packing_list_24h":
        if (data.tripId) {
          navigateFn("TripDetail", { tripId: data.tripId });
        } else {
          // No tripId in payload — fall back to Plan tab
          navigateFn("HomeTabs", { screen: "Plan" });
        }
        break;

      case "weather_alert":
        // WeatherScreen doesn't accept a tripId route param — it's a nested
        // top-tab under HomeTabs > Plan > MyTrips, not a top-level route.
        navigateFn("HomeTabs", {
          screen: "Plan",
          params: { screen: "MyTrips", params: { screen: "Weather" } },
        });
        break;

      case "park_advisory":
        // There is no standalone ParkDetail route — ParksBrowseScreen opens
        // a park's detail via the selectedParkId param instead.
        navigateFn("ParksBrowse", data.parkId ? { selectedParkId: data.parkId } : undefined);
        break;

      case "community_answer":
      case "community_reply":
      case "community_upvote":
      case "community_featured":
        // No content-type-specific detail route is addressable from a bare
        // contentId (could be a tip, question, or photo) — land on Connect.
        navigateFn("HomeTabs", { screen: "Connect" });
        break;

      // Server-queued social types (functions/src/index.ts) — all carry a
      // deepLink with the id already embedded in the path, since the push
      // payload doesn't forward arbitrary fields like tripId/questionId.
      case "friend_request_received":
      case "friend_request_accepted":
      case "question_answered":
      case "trip_member_added":
        if (data.deepLink) {
          navigateToCtaDeepLink(navigateFn, data.deepLink as string);
        } else {
          navigateFn("HomeTabs");
        }
        break;

      case "subscription":
      case "payment_issue":
        navigateFn("Settings");
        break;

      case "badge_earned":
      case "module_progress":
        navigateFn("HomeTabs", { screen: "Learn" });
        break;

      default:
        // Handle onboarding_day_* and inactive_* types → route to Home
        if (data.type?.startsWith("onboarding_day_") || data.type?.startsWith("inactive_")) {
          if (data.deepLink) {
            navigateToCtaDeepLink(navigateFn, data.deepLink as string);
          } else {
            navigateFn("HomeTabs");
          }
          break;
        }
        // If there's a deepLink in the payload, try to navigate to it
        if (data.deepLink) {
          navigateToCtaDeepLink(navigateFn, data.deepLink as string);
          break;
        }
        console.log("[Notifications] Unhandled notification type:", data.type);
    }
  }, [navigateFn]);

  const checkInitialNotification = useCallback(async () => {
    const response = await getInitialNotification();
    if (response) {
      console.log("[Notifications] App launched from notification:", response);
      handleNotificationResponse(response);
    }
  }, [handleNotificationResponse]);

  useEffect(() => {
    // Android requires a notification channel or it falls back to a
    // generic system "Miscellaneous" channel with no custom name/color.
    // No iOS equivalent - setNotificationChannelAsync is a no-op there.
    if (Platform.OS === "android") {
      Notifications.setNotificationChannelAsync("default", {
        name: "Tent & Lantern",
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#1A4C39",
      });
    }

    // Register push token when user is authenticated
    const unsubscribeAuth = auth.onAuthStateChanged(async (user) => {
      if (user) {
        await registerPushToken(user.uid);
      }
    });

    // Check for initial notification (app was launched from notification)
    checkInitialNotification();

    // Listen for notifications received while app is foregrounded
    notificationListener.current = addNotificationReceivedListener((notification) => {
      console.log("[Notifications] Received in foreground:", notification);
      // Could show an in-app notification banner here
    });

    // Listen for notification responses (user tapped notification)
    responseListener.current = addNotificationResponseListener((response) => {
      console.log("[Notifications] User tapped:", response);
      handleNotificationResponse(response);
    });

    // Clear badge when app is opened
    clearBadge();

    return () => {
      unsubscribeAuth();
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, [checkInitialNotification, handleNotificationResponse]);
}

/**
 * Hook to request notification permissions on first launch or when needed
 */
export function useNotificationPermission() {
  useEffect(() => {
    // Could be used to show a permission priming screen
    // or request permissions at an appropriate time
  }, []);
}
