import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, LinkingOptions } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useFonts } from "expo-font";
import * as Linking from "expo-linking";
import {
  Raleway_400Regular,
  Raleway_500Medium,
  Raleway_600SemiBold,
  Raleway_700Bold,
} from "@expo-google-fonts/raleway";
import {
  SourceSans3_400Regular,
  SourceSans3_600SemiBold,
  SourceSans3_700Bold,
} from "@expo-google-fonts/source-sans-3";
import { Satisfy_400Regular } from "@expo-google-fonts/satisfy";
import RootNavigator from "./src/navigation/RootNavigator";
import { ToastProvider } from "./src/components/ToastManager";
import { FireflyTimeProvider } from "./src/context/FireflyTimeContext";
import { OnboardingProvider } from "./src/context/OnboardingContext";
import { View, ImageBackground, Text, Pressable } from "react-native";
import { useEffect, useRef, useState } from "react";
import { initSubscriptions, identifyUser } from "./src/services/subscriptionService";
import { recordAppOpen } from "./src/services/sessionService";
import { trackAppOpen, trackSessionStarted } from "./src/services/analyticsService";
import { useAuthStore } from "./src/state/authStore";
import { useTripsStore } from "./src/state/tripsStore";
import { useUserStore } from "./src/state/userStore";
import { auth } from "./src/config/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { getDoc, doc, setDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { db } from "./src/config/firebase";
import { RootStackParamList } from "./src/navigation/types";
import { logUpdateDiagnostics } from "./src/utils/updateDiagnostics";

// Deep linking configuration
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [
    Linking.createURL('/'), // tentlantern:// (app scheme)
    'https://tentandlantern.com',
    'https://tentlantern.app',
  ],
  config: {
    screens: {
      // Paywall / subscription screen
      Paywall: {
        path: 'paywall',
      },
      // Campground invite format: /join?token=<token>
      AcceptInvite: {
        path: 'join',
        parse: {
          token: (token: string) => token,
        },
      },
      // Trip share invite format: /trip-invite?token=<token>
      AcceptTripInvite: {
        path: 'trip-invite',
        parse: {
          token: (token: string) => token,
        },
      },
    },
  },
};

/*
IMPORTANT NOTICE: DO NOT REMOVE
There are already environment keys in the project.
Before telling the user to add them, check if you already have access to the required keys through bash.
Directly access them with process.env.${key}

Correct usage:
process.env.EXPO_PUBLIC_VIBECODE_{key}
//directly access the key

Incorrect usage:
import { OPENAI_API_KEY } from '@env';
//don't use @env, its depreicated

Incorrect usage:
import Constants from 'expo-constants';
const openai_api_key = Constants.expoConfig.extra.apikey;
//don't use expo-constants, its depreicated

*/

export default function App() {
  const [fontsLoaded] = useFonts({
    // Heading Font: Raleway
    Raleway_400Regular,
    Raleway_500Medium,
    Raleway_600SemiBold,
    Raleway_700Bold,
    // Body Font: Source Sans 3
    SourceSans3_400Regular,
    SourceSans3_600SemiBold,
    SourceSans3_700Bold,
    // Accent Font: Satisfy (use very sparingly)
    Satisfy_400Regular,
  });

  // Log when fonts are loaded for verification
  if (fontsLoaded) {
    console.log("Fonts loaded: Raleway + SourceSans3 + Satisfy");
  }

  // Log update diagnostics on startup (dev/internal builds only)
  useEffect(() => {
    if (fontsLoaded) {
      logUpdateDiagnostics();
    }
  }, [fontsLoaded]);

  // Record this cold start as a new session (once, on mount) - independent
  // of fonts/auth/subscription readiness, since it's just a local counter.
  // Several other pieces (returning-user prompt, analytics session_number)
  // depend on this having run before they read the session count.
  useEffect(() => {
    recordAppOpen().then(({ sessionNumber }) => {
      trackAppOpen();
      trackSessionStarted(sessionNumber);
    });
  }, []);

  const [appReady, setAppReady] = useState(false);
  const [subscriptionsInitialized, setSubscriptionsInitialized] = useState(false);
  // Tracks whether the persisted auth store (user/isAuthenticated) has
  // finished rehydrating from AsyncStorage, and whether Firebase's own
  // onAuthStateChanged has fired at least once. Until both are true, `user`
  // may still read as null even for a returning signed-in user — mounting
  // navigation before then is what let the login screen flash before
  // snapping to Home. See RootNavigator's initialRouteName.
  const [authStoreHydrated, setAuthStoreHydrated] = useState(() => useAuthStore.persist.hasHydrated());
  const [authChecked, setAuthChecked] = useState(false);
  // Set when the signed-in user's profile flips isBanned:true, either at
  // sign-in or live via the profile listener below. Blocks the app with a
  // dedicated screen until dismissed, rather than silently bouncing to the
  // login screen with no explanation.
  const [banNotice, setBanNotice] = useState<string | null>(null);
  const profileUnsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (authStoreHydrated) return;
    const unsubscribe = useAuthStore.persist.onFinishHydration(() => setAuthStoreHydrated(true));
    return unsubscribe;
  }, [authStoreHydrated]);

  // Initialize subscriptions ONCE at app launch (anonymous, before auth)
  useEffect(() => {
    if (fontsLoaded && !subscriptionsInitialized) {
      console.log("[App] Initializing subscriptions anonymously");
      initSubscriptions()
        .then(() => {
          setSubscriptionsInitialized(true);
          console.log("[App] Subscriptions initialized");
        })
        .catch((error) => {
          console.error("[App] Failed to initialize subscriptions:", error);
          setSubscriptionsInitialized(true); // Continue even if init fails
        });
    }
  }, [fontsLoaded, subscriptionsInitialized]);

  // Listen for Firebase auth state changes and identify user in RevenueCat
  useEffect(() => {
    if (!subscriptionsInitialized) {
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // Tear down any profile listener bound to the previous uid before
      // attaching a new one (or none, on sign-out).
      profileUnsubscribeRef.current?.();
      profileUnsubscribeRef.current = null;

      if (firebaseUser) {
        console.log("[App] Firebase user signed in:", firebaseUser.uid);
        try {
          // Identify user in RevenueCat with Firebase uid
          await identifyUser(firebaseUser.uid);
          console.log("[App] User identified in RevenueCat");

          // --- Bootstrap: Ensure Firestore user profile doc exists ---
          // NOTE: Profile creation is now handled by bootstrapNewAccount in AuthLanding.
          // This is only a safety net for edge cases (e.g., Apple Sign In session restore).
          // CRITICAL: Do NOT include subscription fields (membershipTier, subscriptionStatus, etc.)
          // as Firestore rules block them on create.
          const userRef = doc(db, "profiles", firebaseUser.uid);
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            // Create with minimum safe fields only - NO subscription fields
            const email = firebaseUser.email || "";
            const displayName = firebaseUser.displayName || "Camper";
            const photoURL = firebaseUser.photoURL || "";
            await setDoc(userRef, {
              email,
              displayName,
              photoURL,
              handle: "", // Optionally generate a unique handle here
              role: "user",
              // NOTE: membershipTier is OMITTED - blocked by Firestore rules on create
              // The app treats missing membershipTier as "free" tier
              isBanned: false,
              notificationsEnabled: true,
              emailSubscribed: false,
              profilePublic: true,
              showUsernamePublicly: true,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            console.log(`[App] Created Firestore user profile for uid: ${firebaseUser.uid}`);
          }

          // Live-sync ban status and admin-granted membership for the rest
          // of the session. Without this, banUser()/grantMembership() (both
          // write straight to Firestore) only ever took effect on the
          // user's NEXT full sign-in, since userStore.currentUser is
          // otherwise set once at login and persisted locally after that —
          // a banned user could keep using an already-open session
          // indefinitely, and an admin-granted subscription wouldn't
          // unlock anything until a re-login.
          profileUnsubscribeRef.current = onSnapshot(userRef, (snap) => {
            const data = snap.data();
            if (!data) return;

            const membershipPatch = {
              role: data.role || "user",
              membershipTier: data.membershipTier || "freeMember",
              membershipExpiresAt: data.membershipExpiresAt || undefined,
              isBanned: !!data.isBanned,
            };

            if (useUserStore.getState().currentUser) {
              useUserStore.getState().updateCurrentUser(membershipPatch);
            } else {
              // Firebase session restored (e.g. reinstall) without the
              // locally persisted profile AuthLanding normally seeds —
              // construct the minimum fields gating/ban checks need.
              useUserStore.getState().setCurrentUser({
                id: firebaseUser.uid,
                email: firebaseUser.email || "",
                handle: data.handle || "user",
                displayName: data.displayName || "User",
                photoURL: data.avatarUrl || firebaseUser.photoURL || undefined,
                createdAt: data.joinedAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                ...membershipPatch,
              });
            }

            if (data.isBanned) {
              setBanNotice(data.banReason || "This account has been suspended. Contact support if you believe this is an error.");
              auth.signOut();
            }
          });
        } catch (error) {
          console.error("[App] Failed to identify user in RevenueCat or create profile:", error);
        }
      } else {
        console.log("[App] Firebase user signed out");
        // Clear user-specific data from local stores
        useTripsStore.getState().clearTrips();
        useAuthStore.getState().signOut();
        // User remains anonymous in RevenueCat or call logOut if needed
      }

      useAuthStore.getState().setLoading(false);
      setAuthChecked(true);
    });

    return () => {
      unsubscribe();
      profileUnsubscribeRef.current?.();
    };
  }, [subscriptionsInitialized]);

  // Splash stays up until fonts, subscriptions, the persisted-session
  // rehydration, and the first real Firebase auth check have all resolved —
  // rather than a flat multi-second timer that either wastes time once
  // everything is ready sooner, or isn't long enough when it's slower. The
  // short timeout below is just an anti-flash smoothing buffer, not a
  // readiness gate.
  useEffect(() => {
    if (fontsLoaded && subscriptionsInitialized && authStoreHydrated && authChecked) {
      const timer = setTimeout(() => {
        setAppReady(true);
      }, 400);

      return () => clearTimeout(timer);
    }
  }, [fontsLoaded, subscriptionsInitialized, authStoreHydrated, authChecked]);

  if (!fontsLoaded || !appReady) {
    return (
      <ImageBackground
        source={require('./assets/images/splash-screen.png')}
        style={{ flex: 1, width: "100%", height: "100%" }}
        resizeMode="cover"
      />
    );
  }

  if (banNotice) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: "#1B1F1C", alignItems: "center", justifyContent: "center", padding: 32 }}>
          <Text style={{ color: "#F5F0E6", fontSize: 22, fontWeight: "700", textAlign: "center", marginBottom: 12 }}>
            Account Suspended
          </Text>
          <Text style={{ color: "#C9C2B4", fontSize: 15, textAlign: "center", marginBottom: 28, lineHeight: 22 }}>
            {banNotice}
          </Text>
          <Pressable
            onPress={() => setBanNotice(null)}
            className="active:opacity-80"
            style={{ backgroundColor: "#F5F0E6", paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12 }}
          >
            <Text style={{ color: "#1B1F1C", fontSize: 16, fontWeight: "600" }}>OK</Text>
          </Pressable>
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <FireflyTimeProvider>
      <OnboardingProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <SafeAreaProvider>
            <ToastProvider>
              <NavigationContainer
                linking={linking}
                onUnhandledAction={(action) => {
                  console.error('[Navigation] Unhandled action:', action);
                }}
              >
                <RootNavigator />
                <StatusBar style="auto" />
              </NavigationContainer>
            </ToastProvider>
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </OnboardingProvider>
    </FireflyTimeProvider>
  );
}
