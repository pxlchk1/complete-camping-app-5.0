/**
 * My Campsite Screen - Social-style profile
 * Backed by Firestore profiles collection
 */

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ImageBackground,
  Image,
  ActivityIndicator,
  Alert,
  Modal,
  Linking,
  Platform,
} from "react-native";
import { useFocusEffect, useRoute, RouteProp } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { auth, db } from "../config/firebase";
import { doc, getDoc, setDoc, collection, query, where, getDocs, serverTimestamp, orderBy, limit } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { restorePurchases, syncSubscriptionToFirestore } from "../services/subscriptionService";
import { listenToFavoriteParks, removeFavoritePark, FavoritePark } from "../services/favoriteParksService";
import { listenToSavedPlaces, removeSavedPlace, SavedPlace } from "../services/savedPlacesService";
import {
  getFriendCount,
  getFriendConnection,
  sendFriendRequest,
  cancelFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  FriendConnection,
} from "../services/friendsService";
import { useToast } from "../components/ToastManager";
import { notifyError, notifySuccess } from "../ui/notify";
import { getUserGear } from "../services/gearClosetService";
import { GearItem, GEAR_CATEGORIES } from "../types/gear";
import { getUserTripStories } from "../services/photoPostsService";
import { PhotoPost } from "../types/photoPost";
import { ContentVisibility } from "../types/user";
import { useUserStatus } from "../utils/authHelper";
import { useIsModerator, useIsAdministrator } from "../state/userStore";
import { HERO_IMAGES } from "../constants/images";
import AccountRequiredModal from "../components/AccountRequiredModal";
import OnboardingModal from "../components/OnboardingModal";
import MeritBadgesInfoModal from "../components/MeritBadgesInfoModal";
import { useScreenOnboarding } from "../hooks/useScreenOnboarding";
import { bootstrapNewAccount } from "../onboarding";
import {
  DEEP_FOREST,
  EARTH_GREEN,
  GRANITE_GOLD,
  PARCHMENT,
  CARD_BACKGROUND_LIGHT,
  TEXT_PRIMARY_STRONG,
  TEXT_SECONDARY,
  TEXT_MUTED,
  BORDER_SOFT,
  RUST,
} from "../constants/colors";
import { PrefillLocation, RootStackParamList } from "../navigation/types";
import { isLearningTrackBadge, getLearningTrackBadgeImage, LEARNING_TRACK_BADGE_IDS } from "../assets/images/merit_badges/learningTrackBadgeImages";
import { resolveBadgeImage } from "../assets/images/merit_badges/resolveBadgeImage";
import { reconcileMeritBadgesToProfile } from "../services/meritBadgesService";
import type { BadgeId } from "../types/learning";
import { LEARNING_BADGES } from "../types/learning";

type MembershipTier = "free" | "freeMember" | "subscribed" | "weekendCamper" | "trailLeader" | "backcountryGuide" | "isAdmin" | "isModerator";

type ProfileStats = {
  tripsCount: number;
  tipsCount: number;
  gearReviewsCount: number;
  questionsCount: number;
  photosCount: number;
};

type MeritBadge = {
  id: string;
  name: string;
  icon: string;
  imageKey?: string;
  color: string;
  earnedAt?: any;
};

type UserProfile = {
  displayName: string;
  handle: string; // Stored WITHOUT "@"
  email: string;
  avatarUrl: string | null;
  backgroundUrl: string | null;
  membershipTier: MembershipTier;
  bio: string | null;
  about?: string | null;
  location: string | null;
  campingStyle: string | null;
  favoriteCampingStyle?: string;
  favoriteGear?: Record<string, string>;
  joinedAt: any;
  stats?: ProfileStats;
  meritBadges?: MeritBadge[]; // Dynamic merit badges from Firestore
  isProfileContentPublic?: boolean; // Default true - whether content below header is public
  gearClosetVisibility?: ContentVisibility; // Default "private"
  tripStoriesVisibility?: ContentVisibility; // Default "private"
};

type ActivityTab = "photos" | "connect";

// Type for user's recent photos
type UserPhoto = {
  id: string;
  imageUrl: string;
  createdAt: any;
};

// Type for user's recent Connect contributions
type ConnectContribution = {
  id: string;
  type: "tip" | "review" | "question" | "answer";
  title: string;
  createdAt: any;
};

const COVER_HEIGHT = 260;
const PROFILE_SIZE = 120;

export default function MyCampsiteScreen({ navigation }: any) {
  const route = useRoute<RouteProp<RootStackParamList, "MyCampsite">>();
  const viewingUserId = route.params?.userId;
  const viewAsPublic = route.params?.viewAsPublic || false;
  const isViewingOtherUser = !!viewingUserId && viewingUserId !== auth.currentUser?.uid;
  // When viewing as public (preview mode), treat it like viewing another user
  const shouldHidePrivateContent = isViewingOtherUser || viewAsPublic;
  
  const { isGuest } = useUserStatus();
  const isModerator = useIsModerator();
  const isAdministrator = useIsAdministrator();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ActivityTab>("photos");
  const [restoring, setRestoring] = useState(false);
  const [favoriteParks, setFavoriteParks] = useState<FavoritePark[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(true);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [savedPlacesLoading, setSavedPlacesLoading] = useState(true);
  const [showBadgesInfo, setShowBadgesInfo] = useState(false);
  const [userPhotos, setUserPhotos] = useState<UserPhoto[]>([]);
  const [userPhotosLoading, setUserPhotosLoading] = useState(true);
  const [connectContributions, setConnectContributions] = useState<ConnectContribution[]>([]);
  const [connectLoading, setConnectLoading] = useState(true);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [selectedSavedPlace, setSelectedSavedPlace] = useState<SavedPlace | null>(null);
  const [ownFriendCount, setOwnFriendCount] = useState<number | null>(null);
  const [friendConnection, setFriendConnection] = useState<FriendConnection | null>(null);
  const [friendActionLoading, setFriendActionLoading] = useState(false);
  // Sharable gear closet / trip stories - visibility enforced server-side
  // by firestore.rules (gearClosetVisibility / tripStoriesVisibility), so
  // an empty result here just means "nothing to show," not necessarily
  // "nothing exists."
  const [sharedGearItems, setSharedGearItems] = useState<GearItem[]>([]);
  const [tripStories, setTripStories] = useState<PhotoPost[]>([]);
  const insets = useSafeAreaInsets();
  const toast = useToast();

  // Onboarding modal
  const { showModal, currentTooltip, dismissModal, openModal } = useScreenOnboarding("MyCampsite");

  const loadProfile = useCallback(async (userId: string) => {
    try {
      setLoading(true);
      const profileRef = doc(db, "profiles", userId);
      const profileSnap = await getDoc(profileRef);

      if (profileSnap.exists()) {
        let data = profileSnap.data() as UserProfile;

        // Safety net: profile.meritBadges is a denormalized copy that's
        // synced best-effort when a badge is earned, so it can occasionally
        // miss one. Only worth checking (and only safe to write) when this
        // is the signed-in user's own profile.
        if (!isViewingOtherUser) {
          const repaired = await reconcileMeritBadgesToProfile(userId);
          if (repaired) {
            const refreshedSnap = await getDoc(profileRef);
            if (refreshedSnap.exists()) {
              data = refreshedSnap.data() as UserProfile;
            }
          }
        }

        // Normalize handle - remove any "@" prefix if it exists
        const normalizedHandle = data.handle?.replace(/^@+/, "") || "";

        setProfile({
          ...data,
          handle: normalizedHandle,
        });

        // Compute stats if not present
        if (!data.stats) {
          await computeAndSaveStats(userId);
        }
      } else {
        // Create default profile
        await createDefaultProfile(userId);
      }
    } catch (error) {
      console.error("[MyCampsite] Error loading profile:", error);
    } finally {
      setLoading(false);
    }
  }, [isViewingOtherUser]);

  // Load user's latest 9 photos
  const loadUserPhotos = useCallback(async (userId: string) => {
    try {
      setUserPhotosLoading(true);
      const photos: UserPhoto[] = [];
      console.log("[MyCampsite] Loading photos for userId:", userId);
      
      // Get photos from photoPosts collection
      const photoPostsQuery = query(
        collection(db, "photoPosts"),
        where("userId", "==", userId),
        orderBy("createdAt", "desc"),
        limit(9)
      );
      const photoPostsSnap = await getDocs(photoPostsQuery);
      console.log("[MyCampsite] Found photoPosts:", photoPostsSnap.size);
      photoPostsSnap.forEach((doc) => {
        const data = doc.data();
        const imageUrl = data.photoUrls?.[0] || data.imageUrl;
        if (imageUrl) {
          photos.push({
            id: doc.id,
            imageUrl,
            createdAt: data.createdAt,
          });
        }
      });
      
      // If we don't have 9 yet, also check stories collection (legacy)
      if (photos.length < 9) {
        const storiesQuery = query(
          collection(db, "stories"),
          where("userId", "==", userId),
          orderBy("createdAt", "desc"),
          limit(9 - photos.length)
        );
        const storiesSnap = await getDocs(storiesQuery);
        console.log("[MyCampsite] Found stories:", storiesSnap.size);
        storiesSnap.forEach((doc) => {
          const data = doc.data();
          if (data.imageUrl) {
            photos.push({
              id: doc.id,
              imageUrl: data.imageUrl,
              createdAt: data.createdAt,
            });
          }
        });
      }
      
      // Sort by createdAt and take first 9
      photos.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
        const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
        return bTime - aTime;
      });
      
      console.log("[MyCampsite] Total photos loaded:", photos.length);
      setUserPhotos(photos.slice(0, 9));
    } catch (error) {
      console.error("[MyCampsite] Error loading user photos:", error);
      setUserPhotos([]);
    } finally {
      setUserPhotosLoading(false);
    }
  }, []);

  // Load user's latest 9 Connect contributions (tips, reviews, questions, answers)
  const loadConnectContributions = useCallback(async (userId: string) => {
    setConnectLoading(true);

    // Each of these 5 collection queries used to run one after another —
    // now they run in parallel via Promise.all, and each catches its own
    // errors (returning []) so one failing query (e.g. a questions field
    // that doesn't exist for this user) can't block the others.
    const safeQuery = async (
      type: ConnectContribution["type"],
      q: any,
      getTitle: (data: any) => string
    ): Promise<ConnectContribution[]> => {
      try {
        const snap = await getDocs(q);
        return snap.docs.map((doc: any) => {
          const data = doc.data();
          return {
            id: doc.id,
            type,
            title: getTitle(data),
            createdAt: data.createdAt,
          };
        });
      } catch (error) {
        console.error(`[MyCampsite] Error loading ${type} contributions:`, error);
        return [];
      }
    };

    try {
      const [tips, reviews, questionsByAuthorId, questionsByUserId, answers] = await Promise.all([
        safeQuery(
          "tip",
          query(collection(db, "tips"), where("userId", "==", userId), orderBy("createdAt", "desc"), limit(9)),
          (data) => data.title || data.description?.substring(0, 50) || "Tip"
        ),
        // gearReviewsService only ever writes authorId, never userId — the
        // old userId-only query here always returned zero results.
        safeQuery(
          "review",
          query(collection(db, "gearReviews"), where("authorId", "==", userId), orderBy("createdAt", "desc"), limit(9)),
          (data) => data.gearName || data.title || "Gear Review"
        ),
        // Questions check both authorId and userId since different services use different fields.
        safeQuery(
          "question",
          query(collection(db, "questions"), where("authorId", "==", userId), orderBy("createdAt", "desc"), limit(9)),
          (data) => data.title || data.question || data.body?.substring(0, 50) || "Question"
        ),
        safeQuery(
          "question",
          query(collection(db, "questions"), where("userId", "==", userId), orderBy("createdAt", "desc"), limit(9)),
          (data) => data.title || data.question || data.body?.substring(0, 50) || "Question"
        ),
        safeQuery(
          "answer",
          query(collection(db, "answers"), where("authorId", "==", userId), orderBy("createdAt", "desc"), limit(9)),
          (data) => data.body?.substring(0, 50) || "Answer"
        ),
      ]);

      // Dedupe (a question can match both the authorId and userId query)
      const seen = new Set<string>();
      const contributions: ConnectContribution[] = [];
      for (const item of [...tips, ...reviews, ...questionsByAuthorId, ...questionsByUserId, ...answers]) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        contributions.push(item);
      }

      contributions.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
        const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
        return bTime - aTime;
      });

      setConnectContributions(contributions.slice(0, 9));
    } catch (error) {
      console.error("[MyCampsite] Error loading Connect contributions:", error);
      setConnectContributions([]);
    } finally {
      setConnectLoading(false);
    }
  }, []);

  // Own profile: how many friends the viewer has, shown on the Friends
  // quick link. Someone else's profile: the connection state between the
  // signed-in user and that profile, to render Add Friend/Pending/Friends.
  // A public friend *count* for other profiles isn't shown - the
  // users/{uid}/friends subcollection is only readable by its two members,
  // so there's no way to read someone else's total without a denormalized
  // counter, which is out of scope here.
  const loadFriendData = useCallback(async (targetUserId: string) => {
    if (!isViewingOtherUser) {
      try {
        setOwnFriendCount(await getFriendCount(targetUserId));
      } catch (error) {
        console.error("[MyCampsite] Error loading friend count:", error);
      }
    } else if (auth.currentUser) {
      try {
        setFriendConnection(await getFriendConnection(auth.currentUser.uid, targetUserId));
      } catch (error) {
        console.error("[MyCampsite] Error loading friend connection:", error);
      }
    }
  }, [isViewingOtherUser]);

  // Gear Closet and Trip Stories: on own profile these always resolve
  // (owner always has read access); on someone else's profile the
  // Firestore rule silently filters out anything the viewer isn't
  // entitled to see per that person's visibility setting, so a caught
  // error or empty result both just mean "show nothing" here.
  const loadSharedContent = useCallback(async (targetUserId: string) => {
    try {
      setSharedGearItems(await getUserGear(targetUserId));
    } catch (error) {
      console.error("[MyCampsite] Error loading shared gear:", error);
      setSharedGearItems([]);
    }
    try {
      setTripStories(await getUserTripStories(targetUserId));
    } catch (error) {
      console.error("[MyCampsite] Error loading trip stories:", error);
      setTripStories([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      // If viewing another user's profile, use their ID
      const targetUserId = viewingUserId || auth.currentUser?.uid;
      
      if (!targetUserId) {
        // Guest trying to view their own profile - show account required modal
        setLoading(false);
        setShowAccountModal(true);
        return;
      }

      loadProfile(targetUserId);
      
      // Load user photos and Connect contributions
      loadUserPhotos(targetUserId);
      loadConnectContributions(targetUserId);
      loadFriendData(targetUserId);
      loadSharedContent(targetUserId);

      // Only load favorites and saved places for the current user's own profile
      if (!isViewingOtherUser) {
        // Listen to favorite parks
        setFavoritesLoading(true);
        const unsubscribeFavorites = listenToFavoriteParks(targetUserId, (favorites) => {
          setFavoriteParks(favorites);
          setFavoritesLoading(false);
        });

        // Listen to saved places
        setSavedPlacesLoading(true);
        const unsubscribeSavedPlaces = listenToSavedPlaces(targetUserId, (places) => {
          setSavedPlaces(places);
          setSavedPlacesLoading(false);
        });
        
        return () => {
          unsubscribeFavorites();
          unsubscribeSavedPlaces();
        };
      } else {
        // For other users, don't show favorites/saved places
        setFavoritesLoading(false);
        setSavedPlacesLoading(false);
        setFavoriteParks([]);
        setSavedPlaces([]);
      }
    }, [navigation, loadProfile, loadUserPhotos, loadConnectContributions, loadFriendData, loadSharedContent, viewingUserId, isViewingOtherUser, isGuest])
  );

  const createDefaultProfile = async (userId: string) => {
    const user = auth.currentUser;
    if (!user) return;

    // Derive handle from email prefix
    const emailPrefix = user.email?.split("@")[0] || "camper";
    const handle = emailPrefix.toLowerCase().replace(/[^a-z0-9]/g, "");

    try {
      // Use protected onboarding layer for account creation
      const result = await bootstrapNewAccount({
        userId: userId,
        email: user.email || "",
        displayName: user.displayName || "Happy Camper",
        handle: handle,
        photoURL: user.photoURL,
      });

      if (!result.success) {
        console.error("[MyCampsite] Bootstrap failed:", result.error, result.debugInfo);
        return;
      }

      // Set the profile state for UI after successful creation
      const defaultProfile: UserProfile = {
        displayName: user.displayName || "Happy Camper",
        handle: handle,
        email: user.email || "",
        avatarUrl: user.photoURL || null,
        backgroundUrl: null,
        // Note: membershipTier is derived from absence of subscription fields
        // Free users don't have the field set - app logic treats absence as "free"
        membershipTier: "free",
        bio: null,
        location: null,
        campingStyle: null,
        joinedAt: serverTimestamp(),
        stats: {
          tripsCount: 0,
          tipsCount: 0,
          gearReviewsCount: 0,
          questionsCount: 0,
          photosCount: 0,
        },
      };

      setProfile(defaultProfile);
      console.log("[MyCampsite] Profile created successfully via onboarding layer");
    } catch (error) {
      console.error("[MyCampsite] Error creating profile:", error);
    }
  };

  const computeAndSaveStats = async (userId: string) => {
    try {
      // These 6 count queries previously ran one after another; they're
      // independent so they now run in parallel.
      const [tripsSnap, tipsSnap, gearSnap, questionsSnap, storiesSnap, photoPostsSnap] = await Promise.all([
        getDocs(query(collection(db, "trips"), where("userId", "==", userId))),
        getDocs(query(collection(db, "tips"), where("userId", "==", userId))),
        getDocs(query(collection(db, "gearReviews"), where("authorId", "==", userId))),
        getDocs(query(collection(db, "questions"), where("authorId", "==", userId))),
        // Photos are counted from both the legacy "stories" collection and the current "photoPosts" collection.
        getDocs(query(collection(db, "stories"), where("userId", "==", userId))),
        getDocs(query(collection(db, "photoPosts"), where("userId", "==", userId))),
      ]);

      const stats: ProfileStats = {
        tripsCount: tripsSnap.size,
        tipsCount: tipsSnap.size,
        gearReviewsCount: gearSnap.size,
        questionsCount: questionsSnap.size,
        photosCount: storiesSnap.size + photoPostsSnap.size,
      };

      // Update profile with stats
      await setDoc(doc(db, "profiles", userId), { stats }, { merge: true });

      // Update local state
      setProfile((prev) => (prev ? { ...prev, stats } : null));
    } catch (error) {
      console.error("[MyCampsite] Error computing stats:", error);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      if (navigation && navigation.reset) {
        navigation.reset({
          index: 0,
          routes: [{ name: "HomeTabs" }],
        });
      }
    } catch (error) {
      console.error("[MyCampsite] Error signing out:", error);
    }
  };

  const handleRestorePurchases = async () => {
    try {
      setRestoring(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const restored = await restorePurchases();

      if (restored) {
        await syncSubscriptionToFirestore();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          "Purchases Restored",
          "Your subscription has been restored successfully."
        );
      } else {
        Alert.alert(
          "No Purchases Found",
          "No active subscriptions were found for your account."
        );
      }
    } catch (error: any) {
      console.error("[MyCampsite] Restore error:", error);
      Alert.alert(
        "Restore Failed",
        "Unable to restore purchases. Please try again or contact support."
      );
    } finally {
      setRestoring(false);
    }
  };

  const getMembershipLabel = (tier: MembershipTier): string => {
    // Use the profile's membershipTier to determine badge (not the viewer's status)
    // Only profiles with isAdmin in Firebase show "Admin"
    if (tier === "isAdmin") return "Admin";
    if (tier === "isModerator") return "Moderator";
    switch (tier) {
      case "subscribed":
      case "weekendCamper":
      case "trailLeader":
      case "backcountryGuide":
        return "Pro Account";
      default:
        return "Free Account";
    }
  };

  // Shared by both "Plan a trip" entry points below — they only differed in
  // how they built the PrefillLocation, not in the gating/navigation.
  const navigateToCreateTripWithPrefill = (prefillLocation: PrefillLocation) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Gate: Login required to create trips
    if (isGuest || !auth.currentUser) {
      navigation.navigate("Auth");
      return;
    }

    navigation.navigate("CreateTrip", { prefillLocation });
  };

  // Handler for "Plan a trip" from Favorite Parks
  const handlePlanFromFavorite = (fav: FavoritePark) => {
    navigateToCreateTripWithPrefill({
      source: "favorites",
      placeType: "park",
      placeId: fav.parkId,
      name: fav.name,
      subtitle: [fav.type, fav.state].filter(Boolean).join(" • "),
      state: fav.state || null,
      address: null,
      lat: null,
      lng: null,
    });
  };

  // Handler for "Plan a trip" from Saved Places
  const handlePlanFromSavedPlace = (place: SavedPlace) => {
    navigateToCreateTripWithPrefill({
      source: "saved_places",
      placeType: place.placeType === "campground" ? "campground" :
                 place.placeType === "park" ? "park" : "custom",
      placeId: place.placeId,
      name: place.name,
      subtitle: place.address || null,
      state: null,
      address: place.address || null,
      lat: place.lat || null,
      lng: place.lon || null,
    });
  };

  // Saved Places are user-added custom campgrounds, not entries in the
  // parks catalog - there's no ParksBrowse/ParkDetailModal record to open
  // for them, so directions is the closest equivalent to a detail view.
  const handleGetDirections = (place: SavedPlace) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const query = place.lat != null && place.lon != null
      ? `${place.lat},${place.lon}`
      : place.address || place.name;
    const encoded = encodeURIComponent(query);
    const url = Platform.OS === "ios" ? `maps:0,0?q=${encoded}` : `geo:0,0?q=${encoded}`;
    Linking.openURL(url).catch(() => {
      Linking.openURL(`https://maps.google.com/?q=${encoded}`).catch(() => {
        Alert.alert("Couldn't Open Maps", "Unable to open a maps app on this device.");
      });
    });
  };

  const handleSendFriendRequest = async () => {
    if (!auth.currentUser || !viewingUserId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFriendActionLoading(true);
    try {
      await sendFriendRequest(auth.currentUser.uid, viewingUserId);
      // Re-fetch rather than construct locally - the Cancel action below
      // needs the real request id, not a placeholder.
      setFriendConnection(await getFriendConnection(auth.currentUser.uid, viewingUserId));
      notifySuccess(toast, `Friend request sent to ${profile?.displayName || "this camper"}`);
    } catch (error: any) {
      notifyError(toast, error?.message || "Couldn't send friend request. Please try again.");
    } finally {
      setFriendActionLoading(false);
    }
  };

  const handleCancelFriendRequest = async () => {
    if (!friendConnection?.request || !viewingUserId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFriendActionLoading(true);
    try {
      await cancelFriendRequest(friendConnection.request.id);
      setFriendConnection({ status: "none", request: null });
    } catch (error: any) {
      notifyError(toast, error?.message || "Couldn't cancel that request. Please try again.");
    } finally {
      setFriendActionLoading(false);
    }
  };

  const handleAcceptFriendRequest = async () => {
    if (!friendConnection?.request) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setFriendActionLoading(true);
    try {
      await acceptFriendRequest(friendConnection.request);
      setFriendConnection({ status: "friends", request: null });
      notifySuccess(toast, `You and ${profile?.displayName || "this camper"} are now friends`);
    } catch (error: any) {
      notifyError(toast, error?.message || "Couldn't accept that request. Please try again.");
    } finally {
      setFriendActionLoading(false);
    }
  };

  const handleDeclineFriendRequest = async () => {
    if (!friendConnection?.request) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFriendActionLoading(true);
    try {
      await declineFriendRequest(friendConnection.request.id);
      setFriendConnection({ status: "none", request: null });
    } catch (error: any) {
      notifyError(toast, error?.message || "Couldn't decline that request. Please try again.");
    } finally {
      setFriendActionLoading(false);
    }
  };

  const getMembershipBadgeColor = (tier: MembershipTier): string => {
    // Use the profile's membershipTier to determine badge color (not the viewer's status)
    if (tier === "isAdmin") return "#dc2626"; // Red for admin
    if (tier === "isModerator") return "#2563eb"; // Blue for moderator
    switch (tier) {
      case "subscribed":
      case "weekendCamper":
      case "trailLeader":
      case "backcountryGuide":
        return GRANITE_GOLD; // Gold for all Pro tiers
      default:
        return EARTH_GREEN; // Green for free accounts
    }
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: PARCHMENT }}>
        <ActivityIndicator size="large" color={DEEP_FOREST} />
        <Text
          className="mt-4"
          style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}
        >
          Loading your campsite...
        </Text>
      </View>
    );
  }

  // Guest viewing their own My Campsite tab - show account required modal
  if (showAccountModal || (!viewingUserId && !auth.currentUser)) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: PARCHMENT }}>
        <View className="items-center px-6">
          <Ionicons name="person-circle-outline" size={80} color={DEEP_FOREST} />
          <Text
            className="mt-4 text-center"
            style={{ fontFamily: "SourceSans3_600SemiBold", fontSize: 20, color: TEXT_PRIMARY_STRONG }}
          >
            Your Campsite Awaits
          </Text>
          <Text
            className="mt-2 text-center"
            style={{ fontFamily: "SourceSans3_400Regular", fontSize: 16, color: TEXT_SECONDARY }}
          >
            Create an account to save your favorite parks, track trips, and build your camping profile.
          </Text>
        </View>
        <AccountRequiredModal
          visible={true}
          triggerKey="my_campsite"
          onCreateAccount={() => {
            setShowAccountModal(false);
            navigation.navigate("Auth");
          }}
          onLogIn={() => {
            setShowAccountModal(false);
            navigation.navigate("Auth");
          }}
          onMaybeLater={() => {
            setShowAccountModal(false);
            // Navigate back or to home
            if (navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.navigate("HomeTabs" as never);
            }
          }}
        />
      </View>
    );
  }

  // When viewing another user's profile, we don't need auth.currentUser
  // Only require auth.currentUser when viewing own profile (no viewingUserId)
  if (!profile) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: PARCHMENT }}>
        <ActivityIndicator color={DEEP_FOREST} />
      </View>
    );
  }

  const initials = profile.displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // Determine if profile content should be visible
  // Content is visible if:
  // 1. Viewing own profile (not as public preview)
  // 2. Profile content is set to public (default is true)
  const isProfileContentVisible =
    (!shouldHidePrivateContent) ||
    (profile.isProfileContentPublic !== false);

  // Gear Closet / Trip Stories visibility is enforced server-side for a
  // genuinely different viewer (isViewingOtherUser), so sharedGearItems/
  // tripStories already only contain what that viewer is allowed to see.
  // "Preview as public" is a different case: the fetch still runs as the
  // real owner (who always passes the rule), so it can't rely on the
  // server to hide anything - simulate what a stranger would see instead.
  const strangerSeesGearCloset = viewAsPublic && profile.gearClosetVisibility === "public";
  const strangerSeesTripStories = viewAsPublic && profile.tripStoriesVisibility === "public";
  const showGearClosetSection =
    (isViewingOtherUser && sharedGearItems.length > 0) ||
    (strangerSeesGearCloset && sharedGearItems.length > 0);
  const showTripStoriesSection =
    (!shouldHidePrivateContent) ||
    (isViewingOtherUser && tripStories.length > 0) ||
    (strangerSeesTripStories && tripStories.length > 0);

  // Use safe area bottom padding for consistent tab bar height
  const bottomSpacer = Math.max(insets.bottom || 0, 18) + 72;

  return (
    <View className="flex-1" style={{ backgroundColor: PARCHMENT }}>
      {/* Viewing as public banner */}
      {viewAsPublic && (
        <View 
          style={{ 
            backgroundColor: EARTH_GREEN, 
            paddingTop: insets.top + 8,
            paddingBottom: 8,
            paddingHorizontal: 20,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View className="flex-row items-center flex-1">
            <Ionicons name="eye-outline" size={18} color={PARCHMENT} />
            <Text
              className="ml-2"
              style={{ fontFamily: "SourceSans3_600SemiBold", color: PARCHMENT, fontSize: 14 }}
            >
              Viewing as public
            </Text>
          </View>
          <Pressable
            onPress={() => navigation.goBack()}
            className="px-3 py-1 rounded-full active:opacity-70"
            style={{ backgroundColor: "rgba(255,255,255,0.2)" }}
          >
            <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: PARCHMENT, fontSize: 13 }}>
              Done
            </Text>
          </Pressable>
        </View>
      )}
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Hero Header with Background Image */}
        <View style={{ height: COVER_HEIGHT + insets.top }}>
          <ImageBackground
            source={profile.backgroundUrl ? { uri: profile.backgroundUrl } : HERO_IMAGES.WELCOME}
            style={{ width: "100%", height: "100%" }}
            resizeMode="cover"
          >
            {/* Gradient Overlay */}
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(0, 0, 0, 0.3)",
              }}
            />

            {/* Back & Settings Buttons */}
            <View
              style={{
                paddingTop: insets.top + 8,
                paddingHorizontal: 20,
                flexDirection: "row",
                justifyContent: "space-between",
              }}
            >
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  navigation.goBack();
                }}
                className="w-10 h-10 rounded-full items-center justify-center active:opacity-70"
                style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
              >
                <Ionicons name="arrow-back" size={24} color={PARCHMENT} />
              </Pressable>

              {/* Only show edit button for own profile */}
              {!isViewingOtherUser ? (
                <View className="flex-row items-center">
                  {/* Info Button */}
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      openModal();
                    }}
                    className="w-10 h-10 rounded-full items-center justify-center active:opacity-70 mr-2"
                    style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
                  >
                    <Ionicons name="information-circle-outline" size={24} color={PARCHMENT} />
                  </Pressable>
                  {/* Edit Button */}
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      
                      // Gate: Login required to edit profile
                      if (isGuest || !auth.currentUser) {
                        navigation.navigate("Auth");
                        return;
                      }
                      
                      navigation.navigate("EditProfile");
                    }}
                    className="w-10 h-10 rounded-full items-center justify-center active:opacity-70"
                    style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
                  >
                    <Ionicons name="create-outline" size={24} color={PARCHMENT} />
                  </Pressable>
                </View>
              ) : (
                <View style={{ width: 40 }} />
              )}
            </View>

            {/* Centered Avatar and User Identity */}
            <View
              style={{
                position: "absolute",
                top: 20,
                left: 0,
                right: 0,
                bottom: 0,
                alignItems: "center",
                justifyContent: "center",
                paddingTop: 20,
              }}
            >
              {/* Avatar */}
              <View
                style={{
                  width: PROFILE_SIZE,
                  height: PROFILE_SIZE,
                  borderRadius: PROFILE_SIZE / 2,
                  borderWidth: 4,
                  borderColor: PARCHMENT,
                  backgroundColor: PARCHMENT,
                }}
              >
                {profile.avatarUrl ? (
                  <Image
                    source={{ uri: profile.avatarUrl }}
                    style={{
                      width: PROFILE_SIZE - 8,
                      height: PROFILE_SIZE - 8,
                      borderRadius: (PROFILE_SIZE - 8) / 2,
                    }}
                  />
                ) : (
                  <View
                    style={{
                      width: PROFILE_SIZE - 8,
                      height: PROFILE_SIZE - 8,
                      borderRadius: (PROFILE_SIZE - 8) / 2,
                      backgroundColor: DEEP_FOREST,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: "SourceSans3_700Bold",
                        fontSize: 40,
                        color: PARCHMENT,
                      }}
                    >
                      {initials}
                    </Text>
                  </View>
                )}
              </View>

              {/* User Identity */}
              <View className="items-center mt-3">
                <Text
                  style={{ 
                    fontFamily: "Raleway_700Bold", 
                    fontSize: 32,
                    color: PARCHMENT, 
                    textAlign: "center",
                    marginBottom: 2,
                  }}
                >
                  {profile.displayName?.split(" ")?.[0] || profile.displayName || "Camper"}
                </Text>
                <Text
                  className="text-base"
                  style={{ fontFamily: "SourceSans3_400Regular", color: PARCHMENT, opacity: 0.9, textAlign: "center" }}
                >
                  @{profile.handle || "user"}
                </Text>
                
                {/* Membership Badge */}
                <View
                  className="rounded-full px-3 py-1 mt-2"
                  style={{ backgroundColor: getMembershipBadgeColor(profile.membershipTier) }}
                >
                  <Text
                    className="text-xs"
                    style={{ fontFamily: "SourceSans3_600SemiBold", color: PARCHMENT }}
                  >
                    {getMembershipLabel(profile.membershipTier)}
                  </Text>
                </View>
              </View>
            </View>
          </ImageBackground>
        </View>

        {/* Profile Section */}
        <View className="px-5" style={{ marginTop: 16 }}>
          {/* Friend connect button - other users' profiles only, and not
              while previewing your own profile as public */}
          {isViewingOtherUser && !viewAsPublic && auth.currentUser && friendConnection && (
            <View className="mb-4">
              {friendConnection.status === "friends" ? (
                <View
                  className="flex-row items-center justify-center py-3 rounded-xl border"
                  style={{ borderColor: EARTH_GREEN, backgroundColor: `${EARTH_GREEN}15` }}
                >
                  <Ionicons name="checkmark-circle" size={18} color={EARTH_GREEN} />
                  <Text className="ml-2" style={{ fontFamily: "SourceSans3_600SemiBold", color: EARTH_GREEN }}>
                    Friends
                  </Text>
                </View>
              ) : friendConnection.status === "pending_incoming" ? (
                <View className="flex-row" style={{ gap: 8 }}>
                  <Pressable
                    onPress={handleAcceptFriendRequest}
                    disabled={friendActionLoading}
                    className="flex-1 flex-row items-center justify-center py-3 rounded-xl active:opacity-90"
                    style={{ backgroundColor: EARTH_GREEN }}
                  >
                    {friendActionLoading ? (
                      <ActivityIndicator size="small" color={PARCHMENT} />
                    ) : (
                      <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: PARCHMENT }}>
                        Accept Request
                      </Text>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={handleDeclineFriendRequest}
                    disabled={friendActionLoading}
                    className="flex-1 flex-row items-center justify-center py-3 rounded-xl border active:opacity-70"
                    style={{ borderColor: BORDER_SOFT }}
                  >
                    <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_SECONDARY }}>
                      Decline
                    </Text>
                  </Pressable>
                </View>
              ) : friendConnection.status === "pending_outgoing" ? (
                <Pressable
                  onPress={handleCancelFriendRequest}
                  disabled={friendActionLoading}
                  className="flex-row items-center justify-center py-3 rounded-xl border active:opacity-70"
                  style={{ borderColor: BORDER_SOFT }}
                >
                  {friendActionLoading ? (
                    <ActivityIndicator size="small" color={TEXT_SECONDARY} />
                  ) : (
                    <>
                      <Ionicons name="time-outline" size={18} color={TEXT_SECONDARY} />
                      <Text className="ml-2" style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_SECONDARY }}>
                        Request Sent - Cancel
                      </Text>
                    </>
                  )}
                </Pressable>
              ) : (
                <Pressable
                  onPress={handleSendFriendRequest}
                  disabled={friendActionLoading}
                  className="flex-row items-center justify-center py-3 rounded-xl active:opacity-90"
                  style={{ backgroundColor: DEEP_FOREST }}
                >
                  {friendActionLoading ? (
                    <ActivityIndicator size="small" color={PARCHMENT} />
                  ) : (
                    <>
                      <Ionicons name="person-add-outline" size={18} color={PARCHMENT} />
                      <Text className="ml-2" style={{ fontFamily: "SourceSans3_600SemiBold", color: PARCHMENT }}>
                        Add Friend
                      </Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
          )}

          {/* Learning Badges Row */}
          <View className="mb-4">
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowBadgesInfo(true);
              }}
              className="flex-row items-center mb-3"
            >
              <Text
                className="text-sm mr-1"
                style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_SECONDARY }}
              >
                Learning Badges
              </Text>
              <Ionicons name="information-circle-outline" size={16} color={TEXT_SECONDARY} />
            </Pressable>
            {(() => {
              const earnedLearningBadges = profile.meritBadges?.filter((b) => isLearningTrackBadge(b.id)) || [];
              if (earnedLearningBadges.length === 0) {
                return (
                  <View className="items-center px-4 py-2">
                    <Text
                      style={{
                        fontFamily: "SourceSans3_400Regular",
                        fontSize: 13,
                        color: TEXT_SECONDARY,
                        fontStyle: "italic",
                      }}
                    >
                      No learning badges earned yet
                    </Text>
                  </View>
                );
              }
              return (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 16 }}>
                  <View style={{ flexDirection: "row", gap: 12 }}>
                    {earnedLearningBadges.map((badge) => {
                      const badgeImage = getLearningTrackBadgeImage(badge.id as BadgeId);
                      return (
                        <View key={badge.id} style={{ alignItems: "center", width: 72 }}>
                          <View
                            style={{
                              width: 56,
                              height: 56,
                              borderRadius: 28,
                              overflow: "hidden",
                            }}
                          >
                            {badgeImage && (
                              <Image
                                source={badgeImage}
                                style={{
                                  width: "120%",
                                  height: "120%",
                                  marginLeft: "-10%",
                                  marginTop: "-10%",
                                }}
                                resizeMode="cover"
                              />
                            )}
                          </View>
                          <Text
                            style={{
                              fontFamily: "SourceSans3_600SemiBold",
                              fontSize: 9,
                              color: TEXT_PRIMARY_STRONG,
                              lineHeight: 11,
                              textAlign: "center",
                              marginTop: 4,
                            }}
                            numberOfLines={2}
                          >
                            {badge.name}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              );
            })()}
          </View>

          {/* Merit Badges Row */}
          <View className="mb-4">
            <Text
              className="text-sm mb-3"
              style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_SECONDARY }}
            >
              Merit Badges
            </Text>
            {(() => {
              const meritBadgesOnly = profile.meritBadges?.filter((b) => !isLearningTrackBadge(b.id)) || [];
              if (meritBadgesOnly.length === 0) {
                return (
                  <View className="items-center px-4 py-2">
                    <Text
                      style={{
                        fontFamily: "SourceSans3_400Regular",
                        fontSize: 13,
                        color: TEXT_SECONDARY,
                        fontStyle: "italic",
                      }}
                    >
                      No merit badges earned yet
                    </Text>
                  </View>
                );
              }
              return (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 16 }}>
                  <View style={{ flexDirection: "row", gap: 12 }}>
                    {meritBadgesOnly.map((badge) => {
                      const badgeImage = resolveBadgeImage(badge.imageKey || badge.id);
                      return (
                        <View key={badge.id} style={{ alignItems: "center", width: 72 }}>
                          <View
                            style={{
                              width: 56,
                              height: 56,
                              borderRadius: 28,
                              overflow: "hidden",
                            }}
                          >
                            <Image
                              source={badgeImage}
                              style={{
                                width: "120%",
                                height: "120%",
                                marginLeft: "-10%",
                                marginTop: "-10%",
                              }}
                              resizeMode="cover"
                            />
                          </View>
                          <Text
                            style={{
                              fontFamily: "SourceSans3_600SemiBold",
                              fontSize: 9,
                              color: TEXT_PRIMARY_STRONG,
                              lineHeight: 11,
                              textAlign: "center",
                              marginTop: 4,
                            }}
                            numberOfLines={2}
                          >
                            {badge.name}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              );
            })()}
          </View>

          {/* Social Stats Row */}
          <View className="flex-row mb-4 py-3 border-y" style={{ borderColor: BORDER_SOFT }}>
            <View className="flex-1 items-center">
              <Text
                className="text-2xl"
                style={{ fontFamily: "SourceSans3_700Bold", color: TEXT_PRIMARY_STRONG }}
              >
                {profile.stats?.tripsCount || 0}
              </Text>
              <Text
                className="text-xs uppercase"
                style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}
              >
                Trips
              </Text>
            </View>

            <View className="flex-1 items-center">
              <Text
                className="text-2xl"
                style={{ fontFamily: "SourceSans3_700Bold", color: TEXT_PRIMARY_STRONG }}
              >
                {profile.stats?.tipsCount || 0}
              </Text>
              <Text
                className="text-xs uppercase"
                style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}
              >
                Tips
              </Text>
            </View>

            <View className="flex-1 items-center">
              <Text
                className="text-2xl"
                style={{ fontFamily: "SourceSans3_700Bold", color: TEXT_PRIMARY_STRONG }}
              >
                {profile.stats?.gearReviewsCount || 0}
              </Text>
              <Text
                className="text-xs uppercase"
                style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}
              >
                Reviews
              </Text>
            </View>

            <View className="flex-1 items-center">
              <Text
                className="text-2xl"
                style={{ fontFamily: "SourceSans3_700Bold", color: TEXT_PRIMARY_STRONG }}
              >
                {profile.stats?.questionsCount || 0}
              </Text>
              <Text
                className="text-xs uppercase"
                style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}
              >
                Questions
              </Text>
            </View>

            <View className="flex-1 items-center">
              <Text
                className="text-2xl"
                style={{ fontFamily: "SourceSans3_700Bold", color: TEXT_PRIMARY_STRONG }}
              >
                {profile.stats?.photosCount || 0}
              </Text>
              <Text
                className="text-xs uppercase"
                style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}
              >
                Photos
              </Text>
            </View>
          </View>

          {/* Quick Links - Only show on own profile (not when viewing others or as public) */}
          {!shouldHidePrivateContent && (
            <View className="flex-row gap-3 mb-4">
              {/* My Gear Closet */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  navigation.navigate("MyGearCloset");
                }}
                className="flex-1 p-4 rounded-xl border items-center active:opacity-70"
                style={{ backgroundColor: CARD_BACKGROUND_LIGHT, borderColor: BORDER_SOFT }}
              >
                <Ionicons name="bag-handle-outline" size={28} color={EARTH_GREEN} />
                <Text
                  className="mt-2 text-center"
                  style={{ fontFamily: "SourceSans3_600SemiBold", fontSize: 13, color: TEXT_PRIMARY_STRONG }}
                >
                  My Gear Closet
                </Text>
              </Pressable>

              {/* Friends */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  navigation.navigate("MyCampground");
                }}
                className="flex-1 p-4 rounded-xl border items-center active:opacity-70"
                style={{ backgroundColor: CARD_BACKGROUND_LIGHT, borderColor: BORDER_SOFT }}
              >
                <Ionicons name="people-outline" size={28} color={EARTH_GREEN} />
                <Text
                  className="mt-2 text-center"
                  style={{ fontFamily: "SourceSans3_600SemiBold", fontSize: 13, color: TEXT_PRIMARY_STRONG }}
                >
                  Friends
                </Text>
                {ownFriendCount !== null && (
                  <Text
                    className="mt-0.5 text-center"
                    style={{ fontFamily: "SourceSans3_400Regular", fontSize: 11, color: TEXT_SECONDARY }}
                  >
                    {ownFriendCount} {ownFriendCount === 1 ? "friend" : "friends"}
                  </Text>
                )}
              </Pressable>
            </View>
          )}

          {/* Admin Dashboard - Only for admins on own profile */}
          {isAdministrator && !shouldHidePrivateContent && (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                navigation.navigate("AdminDashboard");
              }}
              className="mb-4 p-4 rounded-xl border active:opacity-70"
              style={{ backgroundColor: "#fef2f2", borderColor: "#dc2626" }}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center flex-1">
                  <Ionicons name="shield-checkmark" size={22} color="#dc2626" />
                  <Text
                    className="ml-3"
                    style={{ fontFamily: "SourceSans3_600SemiBold", fontSize: 16, color: "#dc2626" }}
                  >
                    Admin Dashboard
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={22} color="#dc2626" />
              </View>
            </Pressable>
          )}

          {/* About Section */}
          <View className="mb-6 p-4 rounded-xl" style={{ backgroundColor: CARD_BACKGROUND_LIGHT }}>
            <Text
              className="text-lg mb-3"
              style={{ fontFamily: "Raleway_700Bold", color: TEXT_PRIMARY_STRONG }}
            >
              About
            </Text>

            <View className="mb-3">
              {profile.about || profile.bio ? (
                <Text
                  style={{
                    fontFamily: "SourceSans3_400Regular",
                    fontSize: 15,
                    color: TEXT_PRIMARY_STRONG,
                    lineHeight: 22,
                  }}
                >
                  {profile.about || profile.bio}
                </Text>
              ) : (
                <Text
                  style={{
                    fontFamily: "SourceSans3_400Regular",
                    fontSize: 15,
                    color: TEXT_SECONDARY,
                    fontStyle: "italic",
                  }}
                >
                  Add a short bio so campers know you.
                </Text>
              )}
            </View>

            {profile.location && (
              <View className="flex-row items-center mb-2">
                <Ionicons name="location-outline" size={18} color={EARTH_GREEN} />
                <Text
                  className="ml-2"
                  style={{ fontFamily: "SourceSans3_400Regular", fontSize: 15, color: TEXT_PRIMARY_STRONG }}
                >
                  {profile.location}
                </Text>
              </View>
            )}

            {profile.campingStyle && (
              <View className="flex-row items-center mb-2">
                <Ionicons name="bonfire-outline" size={18} color={EARTH_GREEN} />
                <Text
                  className="ml-2"
                  style={{ fontFamily: "SourceSans3_400Regular", fontSize: 15, color: TEXT_PRIMARY_STRONG }}
                >
                  {profile.campingStyle}
                </Text>
              </View>
            )}

            {profile.favoriteCampingStyle && (
              <View className="flex-row items-center mb-2">
                <Ionicons name="compass-outline" size={18} color={EARTH_GREEN} />
                <View className="ml-2">
                  <Text
                    style={{ fontFamily: "SourceSans3_600SemiBold", fontSize: 15, color: EARTH_GREEN }}
                  >
                    Favorite Camping Style
                  </Text>
                  <Text
                    style={{ fontFamily: "SourceSans3_400Regular", fontSize: 15, color: TEXT_PRIMARY_STRONG }}
                  >
                    {profile.favoriteCampingStyle.split('_').map(word => 
                      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                    ).join(' ')}
                  </Text>
                </View>
              </View>
            )}

            {profile.favoriteGear && Object.keys(profile.favoriteGear).length > 0 && (
              <View className="mb-2">
                <View className="flex-row items-start mb-1">
                  <Ionicons name="bag-handle-outline" size={18} color={EARTH_GREEN} style={{ marginTop: 2 }} />
                  <Text
                    className="ml-2"
                    style={{ fontFamily: "SourceSans3_600SemiBold", fontSize: 15, color: EARTH_GREEN }}
                  >
                    Favorite Gear
                  </Text>
                </View>
                <View className="ml-7">
                  {Object.entries(profile.favoriteGear)
                    .filter(([category]) => isNaN(Number(category)) && category.trim().length > 0)
                    .map(([category, details]) => (
                    <View key={category} className="mb-1">
                      <Text
                        style={{ fontFamily: "SourceSans3_400Regular", fontSize: 15, color: TEXT_PRIMARY_STRONG }}
                      >
                        <Text style={{ fontFamily: "SourceSans3_600SemiBold" }}>
                          {category.charAt(0).toUpperCase() + category.slice(1).toLowerCase()}:
                        </Text> {details}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        </View>

        {/* My Activity Section - only visible if profile content is public or viewing own profile */}
        {isProfileContentVisible && (
        <View className="mb-6 px-5">
            <Text
              className="text-lg mb-3"
              style={{ fontFamily: "Raleway_700Bold", color: TEXT_PRIMARY_STRONG }}
            >
              My Activity
            </Text>

            {/* Activity Tabs */}
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              className="mb-4"
            >
              {(["photos", "connect"] as ActivityTab[]).map((tab) => (
                <Pressable
                  key={tab}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setActiveTab(tab);
                  }}
                  className="mr-3 px-4 py-2 rounded-full"
                  style={{
                    backgroundColor: activeTab === tab ? DEEP_FOREST : CARD_BACKGROUND_LIGHT,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "SourceSans3_600SemiBold",
                      fontSize: 14,
                      color: activeTab === tab ? PARCHMENT : TEXT_SECONDARY,
                    }}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Activity Content - Photos Tab */}
            {activeTab === "photos" && (
              userPhotosLoading ? (
                <View className="p-6 rounded-xl items-center" style={{ backgroundColor: CARD_BACKGROUND_LIGHT }}>
                  <ActivityIndicator size="small" color={EARTH_GREEN} />
                  <Text
                    className="mt-2"
                    style={{ fontFamily: "SourceSans3_400Regular", fontSize: 14, color: TEXT_SECONDARY }}
                  >
                    Loading photos...
                  </Text>
                </View>
              ) : userPhotos.length === 0 ? (
                <View className="p-6 rounded-xl items-center" style={{ backgroundColor: CARD_BACKGROUND_LIGHT }}>
                  <Ionicons name="images-outline" size={40} color={EARTH_GREEN} />
                  <Text
                    className="mt-3"
                    style={{ fontFamily: "SourceSans3_600SemiBold", fontSize: 15, color: TEXT_PRIMARY_STRONG }}
                  >
                    No photos yet
                  </Text>
                  <Text
                    className="mt-1 text-center"
                    style={{ fontFamily: "SourceSans3_400Regular", fontSize: 14, color: TEXT_SECONDARY }}
                  >
                    Your photos will appear here
                  </Text>
                </View>
              ) : (
                <View className="rounded-xl overflow-hidden" style={{ backgroundColor: CARD_BACKGROUND_LIGHT }}>
                  {/* 3x3 Photo Grid */}
                  <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    {userPhotos.map((photo, index) => (
                      <Pressable
                        key={photo.id}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          navigation.navigate("PhotoDetail", { photoId: photo.id });
                        }}
                        style={{
                          width: "33.33%",
                          aspectRatio: 1,
                          padding: 1,
                        }}
                      >
                        <Image
                          source={{ uri: photo.imageUrl }}
                          style={{ width: "100%", height: "100%", backgroundColor: BORDER_SOFT }}
                        />
                      </Pressable>
                    ))}
                  </View>
                </View>
              )
            )}

            {/* Activity Content - Connect Tab */}
            {activeTab === "connect" && (
              connectLoading ? (
                <View className="p-6 rounded-xl items-center" style={{ backgroundColor: CARD_BACKGROUND_LIGHT }}>
                  <ActivityIndicator size="small" color={EARTH_GREEN} />
                  <Text
                    className="mt-2"
                    style={{ fontFamily: "SourceSans3_400Regular", fontSize: 14, color: TEXT_SECONDARY }}
                  >
                    Loading contributions...
                  </Text>
                </View>
              ) : connectContributions.length === 0 ? (
                <View className="p-6 rounded-xl items-center" style={{ backgroundColor: CARD_BACKGROUND_LIGHT }}>
                  <Ionicons name="chatbubbles-outline" size={40} color={EARTH_GREEN} />
                  <Text
                    className="mt-3"
                    style={{ fontFamily: "SourceSans3_600SemiBold", fontSize: 15, color: TEXT_PRIMARY_STRONG }}
                  >
                    No contributions yet
                  </Text>
                  <Text
                    className="mt-1 text-center"
                    style={{ fontFamily: "SourceSans3_400Regular", fontSize: 14, color: TEXT_SECONDARY }}
                  >
                    Your tips, reviews, and questions will appear here
                  </Text>
                </View>
              ) : (
                <View className="rounded-xl overflow-hidden" style={{ backgroundColor: CARD_BACKGROUND_LIGHT }}>
                  {connectContributions.map((contribution, index) => (
                    <Pressable
                      key={`${contribution.type}-${contribution.id}`}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        // Navigate to appropriate screen based on type
                        if (contribution.type === "question") {
                          navigation.navigate("QuestionDetail", { questionId: contribution.id });
                        } else if (contribution.type === "review") {
                          navigation.navigate("GearReviewDetail", { reviewId: contribution.id });
                        } else if (contribution.type === "tip") {
                          navigation.navigate("TipDetail", { tipId: contribution.id });
                        }
                        // Answers don't have their own detail screen
                      }}
                      className="flex-row items-center px-4 py-3"
                      style={{
                        borderBottomWidth: index < connectContributions.length - 1 ? 1 : 0,
                        borderBottomColor: BORDER_SOFT,
                      }}
                    >
                      <View
                        className="w-8 h-8 rounded-full items-center justify-center mr-3"
                        style={{
                          backgroundColor: 
                            contribution.type === "tip" ? "#dcfce7" :
                            contribution.type === "review" ? "#fef3c7" :
                            contribution.type === "question" ? "#dbeafe" :
                            "#f3e8ff",
                        }}
                      >
                        <Ionicons
                          name={
                            contribution.type === "tip" ? "bulb-outline" :
                            contribution.type === "review" ? "star-outline" :
                            contribution.type === "question" ? "help-circle-outline" :
                            "chatbubble-outline"
                          }
                          size={16}
                          color={
                            contribution.type === "tip" ? "#16a34a" :
                            contribution.type === "review" ? "#d97706" :
                            contribution.type === "question" ? "#2563eb" :
                            "#9333ea"
                          }
                        />
                      </View>
                      <View className="flex-1">
                        <Text
                          numberOfLines={1}
                          style={{
                            fontFamily: "SourceSans3_600SemiBold",
                            fontSize: 14,
                            color: TEXT_PRIMARY_STRONG,
                          }}
                        >
                          {contribution.title}
                        </Text>
                        <Text
                          style={{
                            fontFamily: "SourceSans3_400Regular",
                            fontSize: 12,
                            color: TEXT_SECONDARY,
                            textTransform: "capitalize",
                          }}
                        >
                          {contribution.type === "review" ? "Gear Review" : contribution.type}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={TEXT_SECONDARY} />
                    </Pressable>
                  ))}
                </View>
              )
            )}
        </View>
        )}

        {/* Favorite Parks Section - only visible when viewing own profile (never public) */}
        {!shouldHidePrivateContent && (
        <View className="mb-6 px-5">
          <Text
            className="text-lg mb-3"
            style={{ fontFamily: "Raleway_700Bold", color: TEXT_PRIMARY_STRONG }}
          >
            Favorite Parks
          </Text>

          {favoritesLoading ? (
            <View className="p-6 rounded-xl items-center" style={{ backgroundColor: CARD_BACKGROUND_LIGHT }}>
              <ActivityIndicator size="small" color={EARTH_GREEN} />
              <Text
                className="mt-2"
                style={{ fontFamily: "SourceSans3_400Regular", fontSize: 14, color: TEXT_SECONDARY }}
              >
                Loading favorites...
              </Text>
            </View>
          ) : favoriteParks.length === 0 ? (
            <View className="p-6 rounded-xl items-center" style={{ backgroundColor: CARD_BACKGROUND_LIGHT }}>
              <Ionicons name="heart-outline" size={40} color={RUST} />
              <Text
                className="mt-3"
                style={{ fontFamily: "SourceSans3_600SemiBold", fontSize: 15, color: TEXT_PRIMARY_STRONG }}
              >
                No favorites yet
              </Text>
              <Text
                className="mt-1 text-center px-4"
                style={{ fontFamily: "SourceSans3_400Regular", fontSize: 14, color: TEXT_SECONDARY }}
              >
                Save parks you love so they show up here.
              </Text>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  navigation.navigate("HomeTabs", { screen: "Plan" });
                }}
                className="mt-4 px-5 py-2 rounded-full"
                style={{ backgroundColor: EARTH_GREEN }}
              >
                <Text
                  style={{ fontFamily: "SourceSans3_600SemiBold", fontSize: 14, color: PARCHMENT }}
                >
                  Browse Parks
                </Text>
              </Pressable>
            </View>
          ) : (
            <View>
              {favoriteParks.map((fav) => (
                <Pressable
                  key={fav.parkId}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    // ParksBrowse opens this park's detail modal directly via
                    // selectedParkId (same pattern push notifications use) -
                    // this used to route through the Plan tab's nested
                    // MyTrips screen, which doesn't read selectedParkId at
                    // all, so tapping a favorite silently dropped the user
                    // onto whatever Plan tab happened to be active.
                    navigation.navigate("ParksBrowse", { selectedParkId: fav.parkId });
                  }}
                  className="p-4 rounded-xl border mb-3 active:opacity-90"
                  style={{ backgroundColor: CARD_BACKGROUND_LIGHT, borderColor: BORDER_SOFT }}
                >
                  <View className="flex-row items-start justify-between">
                    <View className="flex-1 mr-3">
                      <Text
                        className="text-base mb-1"
                        style={{ fontFamily: "Raleway_600SemiBold", color: TEXT_PRIMARY_STRONG }}
                        numberOfLines={2}
                      >
                        {fav.name}
                      </Text>
                      <View className="flex-row items-center">
                        <Text
                          className="text-sm"
                          style={{ fontFamily: "SourceSans3_500Medium", color: TEXT_SECONDARY }}
                        >
                          {fav.type}
                        </Text>
                        {fav.state && (
                          <>
                            <Text className="mx-1" style={{ color: TEXT_SECONDARY }}>•</Text>
                            <Text
                              className="text-sm"
                              style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}
                            >
                              {fav.state}
                            </Text>
                          </>
                        )}
                      </View>
                    </View>
                    <View className="flex-row items-center" style={{ gap: 8 }}>
                      {/* Plan a trip button */}
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          handlePlanFromFavorite(fav);
                        }}
                        className="w-9 h-9 rounded-full items-center justify-center active:opacity-70"
                        style={{ backgroundColor: "#f0f9f4" }}
                        accessibilityLabel="Plan a trip here"
                      >
                        <Ionicons name="calendar-outline" size={18} color={EARTH_GREEN} />
                      </Pressable>
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          Alert.alert(
                            "Remove from Favorites?",
                            `Remove ${fav.name} from your favorites?`,
                            [
                              { text: "Cancel", style: "cancel" },
                              {
                                text: "Remove",
                                style: "destructive",
                                onPress: async () => {
                                  const userId = auth.currentUser?.uid;
                                  if (!userId) return;
                                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                                  await removeFavoritePark(userId, fav.parkId);
                                },
                              },
                            ]
                          );
                        }}
                        className="w-9 h-9 rounded-full items-center justify-center active:opacity-70"
                        style={{ backgroundColor: "#fff5f5" }}
                        accessibilityLabel="Remove from favorites"
                      >
                        <Ionicons name="heart" size={20} color={RUST} />
                      </Pressable>
                    </View>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>
        )}

        {/* Parks I've Added Section - only visible when viewing own profile (never public) */}
        {!shouldHidePrivateContent && (
        <View className="mb-6 px-5">
          <Text
            className="text-lg mb-3"
            style={{ fontFamily: "Raleway_700Bold", color: TEXT_PRIMARY_STRONG }}
          >
            Parks I've added
          </Text>

          {savedPlacesLoading ? (
            <View className="p-6 rounded-xl items-center" style={{ backgroundColor: CARD_BACKGROUND_LIGHT }}>
              <ActivityIndicator size="small" color={EARTH_GREEN} />
              <Text
                className="mt-2"
                style={{ fontFamily: "SourceSans3_400Regular", fontSize: 14, color: TEXT_SECONDARY }}
              >
                Loading parks...
              </Text>
            </View>
          ) : savedPlaces.length === 0 ? (
            <View className="p-6 rounded-xl items-center" style={{ backgroundColor: CARD_BACKGROUND_LIGHT }}>
              <Ionicons name="location-outline" size={40} color={EARTH_GREEN} />
              <Text
                className="mt-3"
                style={{ fontFamily: "SourceSans3_600SemiBold", fontSize: 15, color: TEXT_PRIMARY_STRONG }}
              >
                No parks added yet
              </Text>
              <Text
                className="mt-1 text-center px-4"
                style={{ fontFamily: "SourceSans3_400Regular", fontSize: 14, color: TEXT_SECONDARY }}
              >
                Add your own campgrounds from Plan &gt; Parks.
              </Text>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  navigation.navigate("HomeTabs", { screen: "Plan" });
                }}
                className="mt-4 px-5 py-2 rounded-full"
                style={{ backgroundColor: EARTH_GREEN }}
              >
                <Text
                  style={{ fontFamily: "SourceSans3_600SemiBold", fontSize: 14, color: PARCHMENT }}
                >
                  Browse Parks
                </Text>
              </Pressable>
            </View>
          ) : (
            <View>
              {savedPlaces.map((place) => (
                <Pressable
                  key={place.placeId}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedSavedPlace(place);
                  }}
                  className="p-4 rounded-xl border mb-3 active:opacity-90"
                  style={{ backgroundColor: CARD_BACKGROUND_LIGHT, borderColor: BORDER_SOFT }}
                >
                  <View className="flex-row items-start justify-between">
                    <View className="flex-1 mr-3">
                      <Text
                        className="text-base mb-1"
                        style={{ fontFamily: "Raleway_600SemiBold", color: TEXT_PRIMARY_STRONG }}
                        numberOfLines={2}
                      >
                        {place.name}
                      </Text>
                      <View className="flex-row items-center">
                        <Text
                          className="text-sm"
                          style={{ fontFamily: "SourceSans3_500Medium", color: TEXT_SECONDARY }}
                        >
                          {place.placeType === "campground" ? "Campground" : 
                           place.placeType === "park" ? "Park" : 
                           place.placeType === "trailhead" ? "Trailhead" : "Other"}
                        </Text>
                        {place.address && (
                          <>
                            <Text className="mx-1" style={{ color: TEXT_SECONDARY }}>•</Text>
                            <Text
                              className="text-sm flex-1"
                              style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}
                              numberOfLines={1}
                            >
                              {place.address}
                            </Text>
                          </>
                        )}
                      </View>
                      {place.notes && (
                        <Text
                          className="text-sm mt-1"
                          style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY, fontStyle: "italic" }}
                          numberOfLines={2}
                        >
                          {place.notes}
                        </Text>
                      )}
                    </View>
                    <View className="flex-row items-center" style={{ gap: 8 }}>
                      {/* Plan a trip button */}
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          handlePlanFromSavedPlace(place);
                        }}
                        className="w-9 h-9 rounded-full items-center justify-center active:opacity-70"
                        style={{ backgroundColor: "#f0f9f4" }}
                        accessibilityLabel="Plan a trip here"
                      >
                        <Ionicons name="calendar-outline" size={18} color={EARTH_GREEN} />
                      </Pressable>
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          Alert.alert(
                            "Remove Park?",
                            `Remove ${place.name} from your saved parks?`,
                            [
                              { text: "Cancel", style: "cancel" },
                              {
                                text: "Remove",
                                style: "destructive",
                                onPress: async () => {
                                  const userId = auth.currentUser?.uid;
                                  if (!userId) return;
                                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                                  await removeSavedPlace(userId, place.placeId);
                                },
                              },
                            ]
                          );
                        }}
                        className="w-9 h-9 rounded-full items-center justify-center active:opacity-70"
                        style={{ backgroundColor: "#f0f9f4" }}
                        accessibilityLabel="Remove park"
                      >
                        <Ionicons name="location" size={20} color={EARTH_GREEN} />
                      </Pressable>
                    </View>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>
        )}

        {/* Gear Closet - other users' profiles only (own profile already
            has the My Gear Closet quick link above for full management).
            Only renders when the owner's gearClosetVisibility setting
            allows this viewer to see it - an empty result from the
            Firestore-rule-gated fetch just means nothing to show. */}
        {showGearClosetSection && (
          <View className="mb-6 px-5">
            <Text
              className="text-lg mb-3"
              style={{ fontFamily: "Raleway_700Bold", color: TEXT_PRIMARY_STRONG }}
            >
              Gear Closet
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 16 }}>
              <View style={{ flexDirection: "row", gap: 12 }}>
                {sharedGearItems.map((item) => (
                  <View
                    key={item.id}
                    className="rounded-xl border p-3"
                    style={{ backgroundColor: CARD_BACKGROUND_LIGHT, borderColor: BORDER_SOFT, width: 130 }}
                  >
                    <View
                      className="rounded-lg items-center justify-center mb-2"
                      style={{ backgroundColor: PARCHMENT, height: 80 }}
                    >
                      {item.imageUrl ? (
                        <Image
                          source={{ uri: item.imageUrl }}
                          style={{ width: "100%", height: "100%", borderRadius: 8 }}
                          resizeMode="cover"
                        />
                      ) : (
                        <Ionicons name="bag-handle-outline" size={28} color={EARTH_GREEN} />
                      )}
                    </View>
                    <Text
                      numberOfLines={1}
                      style={{ fontFamily: "SourceSans3_600SemiBold", fontSize: 13, color: TEXT_PRIMARY_STRONG }}
                    >
                      {item.name}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{ fontFamily: "SourceSans3_400Regular", fontSize: 11, color: TEXT_SECONDARY }}
                    >
                      {GEAR_CATEGORIES.find((c) => c.value === item.category)?.label || item.category}
                    </Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        )}

        {/* Trip Stories - own profile always shows (with a prompt when
            empty); other users' profiles only show when the owner's
            tripStoriesVisibility setting allows this viewer to see them. */}
        {showTripStoriesSection && (
          <View className="mb-6 px-5">
            <Text
              className="text-lg mb-3"
              style={{ fontFamily: "Raleway_700Bold", color: TEXT_PRIMARY_STRONG }}
            >
              Trip Stories
            </Text>
            {tripStories.length === 0 ? (
              <View className="p-6 rounded-xl items-center border" style={{ backgroundColor: CARD_BACKGROUND_LIGHT, borderColor: BORDER_SOFT }}>
                <Ionicons name="book-outline" size={40} color={EARTH_GREEN} />
                <Text
                  className="mt-3"
                  style={{ fontFamily: "SourceSans3_600SemiBold", fontSize: 15, color: TEXT_PRIMARY_STRONG }}
                >
                  No trip stories yet
                </Text>
                <Text
                  className="mt-1 text-center px-4"
                  style={{ fontFamily: "SourceSans3_400Regular", fontSize: 14, color: TEXT_SECONDARY }}
                >
                  Tag a photo to a trip when you share it to start your story.
                </Text>
                {!shouldHidePrivateContent && (
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      navigation.navigate("PhotoComposer", {});
                    }}
                    className="mt-4 px-5 py-2 rounded-full"
                    style={{ backgroundColor: EARTH_GREEN }}
                  >
                    <Text style={{ fontFamily: "SourceSans3_600SemiBold", fontSize: 14, color: PARCHMENT }}>
                      Share a Photo
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 16 }}>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  {tripStories.map((post) => (
                    <Pressable
                      key={post.id}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        navigation.navigate("PhotoDetail", { storyId: post.id });
                      }}
                      className="rounded-xl overflow-hidden border active:opacity-90"
                      style={{ backgroundColor: CARD_BACKGROUND_LIGHT, borderColor: BORDER_SOFT, width: 150 }}
                    >
                      <Image
                        source={{ uri: post.photoUrls?.[0] }}
                        style={{ width: "100%", height: 100, backgroundColor: BORDER_SOFT }}
                        resizeMode="cover"
                      />
                      <View className="p-2">
                        <Text
                          numberOfLines={1}
                          style={{ fontFamily: "SourceSans3_600SemiBold", fontSize: 12, color: TEXT_PRIMARY_STRONG }}
                        >
                          {post.tripName || "Trip Story"}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            )}
          </View>
        )}

        {/* Account Actions - only show on own profile (not when viewing others) */}
        {!shouldHidePrivateContent && (
        <View className="px-5">
          {/* Restore Purchases Button */}
          <Pressable
            onPress={handleRestorePurchases}
            disabled={restoring}
            className="mb-4 py-4 rounded-xl border-2 active:opacity-70"
            style={{ borderColor: EARTH_GREEN, backgroundColor: CARD_BACKGROUND_LIGHT }}
          >
            <View className="flex-row items-center justify-center">
              {restoring ? (
                <ActivityIndicator size="small" color={EARTH_GREEN} />
              ) : (
                <>
                  <Ionicons name="reload-circle-outline" size={24} color={EARTH_GREEN} />
                  <Text
                    className="ml-2"
                    style={{
                      fontFamily: "SourceSans3_600SemiBold",
                      fontSize: 16,
                      color: TEXT_PRIMARY_STRONG,
                    }}
                  >
                    Restore Purchases
                  </Text>
                </>
              )}
            </View>
          </Pressable>

          {/* Sign Out Button */}
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              handleSignOut();
            }}
            className="mb-6 py-3 rounded-lg active:opacity-90"
            style={{ backgroundColor: "#dc2626" }}
          >
            <Text
              className="text-center"
              style={{
                fontFamily: "SourceSans3_600SemiBold",
                fontSize: 16,
                color: PARCHMENT,
              }}
            >
              Sign Out
            </Text>
          </Pressable>
        </View>
        )}

        {/* Private Profile Message - shown when viewing other user's private profile */}
        {shouldHidePrivateContent && !isProfileContentVisible && (
          <View className="mb-6 px-5">
            <View 
              className="p-6 rounded-xl items-center" 
              style={{ backgroundColor: CARD_BACKGROUND_LIGHT }}
            >
              <Ionicons name="lock-closed-outline" size={40} color={TEXT_MUTED} />
              <Text
                className="mt-3 text-center"
                style={{ fontFamily: "SourceSans3_600SemiBold", fontSize: 15, color: TEXT_PRIMARY_STRONG }}
              >
                This profile is private
              </Text>
              <Text
                className="mt-1 text-center"
                style={{ fontFamily: "SourceSans3_400Regular", fontSize: 14, color: TEXT_SECONDARY }}
              >
                The user has chosen to keep their activity and content private.
              </Text>
            </View>
          </View>
        )}

        {/* Bottom Spacer for Tab Bar */}
        <View style={{ height: bottomSpacer }} />
      </ScrollView>

      {/* Saved Place detail - user-added custom campgrounds aren't in the
          parks catalog, so there's no ParksBrowse/ParkDetailModal record to
          open for them; this is their equivalent detail view. */}
      <Modal
        visible={!!selectedSavedPlace}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedSavedPlace(null)}
      >
        <Pressable
          className="flex-1 items-center justify-center px-6"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onPress={() => setSelectedSavedPlace(null)}
        >
          {selectedSavedPlace && (
            <Pressable
              className="w-full rounded-2xl p-5"
              style={{ backgroundColor: PARCHMENT }}
              onPress={(e) => e.stopPropagation()}
            >
              <View className="flex-row items-start justify-between mb-1">
                <Text
                  className="text-xl flex-1 mr-3"
                  style={{ fontFamily: "Raleway_700Bold", color: TEXT_PRIMARY_STRONG }}
                >
                  {selectedSavedPlace.name}
                </Text>
                <Pressable
                  onPress={() => setSelectedSavedPlace(null)}
                  className="w-8 h-8 rounded-full items-center justify-center active:opacity-70"
                  style={{ backgroundColor: CARD_BACKGROUND_LIGHT }}
                  accessibilityLabel="Close"
                >
                  <Ionicons name="close" size={18} color={TEXT_SECONDARY} />
                </Pressable>
              </View>

              <Text
                className="text-sm mb-4"
                style={{ fontFamily: "SourceSans3_600SemiBold", color: EARTH_GREEN }}
              >
                {selectedSavedPlace.placeType === "campground" ? "Campground" :
                 selectedSavedPlace.placeType === "park" ? "Park" :
                 selectedSavedPlace.placeType === "trailhead" ? "Trailhead" : "Other"}
              </Text>

              {selectedSavedPlace.address && (
                <View className="flex-row items-start mb-3">
                  <Ionicons name="location-outline" size={18} color={EARTH_GREEN} style={{ marginTop: 2 }} />
                  <Text
                    className="ml-2 flex-1"
                    style={{ fontFamily: "SourceSans3_400Regular", fontSize: 15, color: TEXT_PRIMARY_STRONG }}
                  >
                    {selectedSavedPlace.address}
                  </Text>
                </View>
              )}

              {selectedSavedPlace.notes && (
                <View className="mb-4 p-3 rounded-xl" style={{ backgroundColor: CARD_BACKGROUND_LIGHT }}>
                  <Text
                    style={{ fontFamily: "SourceSans3_400Regular", fontSize: 14, color: TEXT_SECONDARY, fontStyle: "italic" }}
                  >
                    {selectedSavedPlace.notes}
                  </Text>
                </View>
              )}

              <Pressable
                onPress={() => handleGetDirections(selectedSavedPlace)}
                className="flex-row items-center justify-center py-3 rounded-xl mb-2 active:opacity-90"
                style={{ backgroundColor: EARTH_GREEN }}
              >
                <Ionicons name="navigate-outline" size={18} color={PARCHMENT} />
                <Text className="ml-2" style={{ fontFamily: "SourceSans3_600SemiBold", color: PARCHMENT }}>
                  Get Directions
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  const place = selectedSavedPlace;
                  setSelectedSavedPlace(null);
                  handlePlanFromSavedPlace(place);
                }}
                className="flex-row items-center justify-center py-3 rounded-xl mb-2 active:opacity-90 border"
                style={{ borderColor: DEEP_FOREST }}
              >
                <Ionicons name="calendar-outline" size={18} color={DEEP_FOREST} />
                <Text className="ml-2" style={{ fontFamily: "SourceSans3_600SemiBold", color: DEEP_FOREST }}>
                  Plan a Trip Here
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  const place = selectedSavedPlace;
                  setSelectedSavedPlace(null);
                  Alert.alert(
                    "Remove Park?",
                    `Remove ${place.name} from your saved parks?`,
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Remove",
                        style: "destructive",
                        onPress: async () => {
                          const userId = auth.currentUser?.uid;
                          if (!userId) return;
                          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                          await removeSavedPlace(userId, place.placeId);
                        },
                      },
                    ]
                  );
                }}
                className="items-center py-2"
              >
                <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: RUST }}>
                  Remove from Saved Parks
                </Text>
              </Pressable>
            </Pressable>
          )}
        </Pressable>
      </Modal>

      {/* Merit Badges Info Modal — shared with the Learn tab so this copy
          can't drift again (this used to be a locally-defined modal
          describing fabricated example badges, e.g. "Weekend Camper",
          "Trail Leader", that don't exist in the real catalog). */}
      <MeritBadgesInfoModal
        visible={showBadgesInfo}
        onDismiss={() => setShowBadgesInfo(false)}
      />

      {/* Onboarding Modal */}
      <OnboardingModal
        visible={showModal}
        tooltip={currentTooltip}
        onDismiss={dismissModal}
      />
    </View>
  );
}
