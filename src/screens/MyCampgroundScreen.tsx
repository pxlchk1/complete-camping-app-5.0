// src/screens/MyCampgroundScreen.tsx
/**
 * Friends Screen (route name kept as "MyCampground" to avoid a
 * navigation-wide rename)
 *
 * One connections graph: search for people already on the app and send a
 * friend request; everyone you're connected to shows as a "Friend"; tag
 * any friend into "My Campground" - the subset you actually go camping
 * with. People without accounts (kids, pets, camping buddies who haven't
 * joined yet) are managed separately as Guests, reusing the existing
 * campgroundContacts contact-card + invite flow.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Image,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { auth } from "../config/firebase";
import {
  getFriends,
  getIncomingFriendRequests,
  getOutgoingFriendRequests,
  searchUsersByHandle,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  removeFriend,
  addToCampground,
  removeFromCampground,
} from "../services/friendsService";
import { Friend, FriendRequest } from "../types/friends";
import { User } from "../types/user";
import {
  getCampgroundContacts,
  deleteCampgroundContact,
} from "../services/campgroundContactsService";
import { CampgroundContact } from "../types/campground";
import { RootStackNavigationProp } from "../navigation/types";
import ModalHeader from "../components/ModalHeader";
import InviteOptionsSheet from "../components/InviteOptionsSheet";
import ConfirmationModal from "../components/ConfirmationModal";
import OnboardingModal from "../components/OnboardingModal";
import { useScreenOnboarding } from "../hooks/useScreenOnboarding";
import { useToast } from "../components/ToastManager";
import { notifyError, notifySuccess } from "../ui/notify";
import {
  DEEP_FOREST,
  EARTH_GREEN,
  PARCHMENT,
  CARD_BACKGROUND_LIGHT,
  BORDER_SOFT,
  TEXT_PRIMARY_STRONG,
  TEXT_SECONDARY,
  TEXT_MUTED,
  RUST,
} from "../constants/colors";

function Avatar({ uri, name, size = 44 }: { uri?: string | null; name: string; size?: number }) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: BORDER_SOFT }}
      />
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: DEEP_FOREST,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontFamily: "SourceSans3_700Bold", color: PARCHMENT, fontSize: size * 0.36 }}>
        {initials || "?"}
      </Text>
    </View>
  );
}

export default function MyCampgroundScreen() {
  const navigation = useNavigation<RootStackNavigationProp>();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const userId = auth.currentUser?.uid;

  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [guests, setGuests] = useState<CampgroundContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [requestingUids, setRequestingUids] = useState<Set<string>>(new Set());
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Invite sheet (guests only)
  const [showInviteSheet, setShowInviteSheet] = useState(false);
  const [selectedGuest, setSelectedGuest] = useState<CampgroundContact | null>(null);

  // Confirmations
  const [pendingRemoveFriend, setPendingRemoveFriend] = useState<Friend | null>(null);
  const [pendingDeleteGuest, setPendingDeleteGuest] = useState<CampgroundContact | null>(null);

  const [showWhatIsThis, setShowWhatIsThis] = useState(false);

  const { showModal, currentTooltip, dismissModal, openModal } = useScreenOnboarding("MyCampground");

  const loadAll = useCallback(async () => {
    if (!userId) {
      setError("Please sign in to view your friends");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      setError(null);
      const [friendsData, incomingData, outgoingData, contactsData] = await Promise.all([
        getFriends(userId),
        getIncomingFriendRequests(userId),
        getOutgoingFriendRequests(userId),
        getCampgroundContacts(userId),
      ]);
      setFriends(friendsData);
      setIncoming(incomingData);
      setOutgoing(outgoingData);
      // Guests are contacts with no linked account - people without the
      // app (kids, pets, camping buddies who haven't joined yet).
      setGuests(contactsData.filter((c) => !c.contactUserId));
    } catch (err: any) {
      console.error("[Friends] Error loading:", err);
      setError(err?.message || "Failed to load your friends");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadAll();
  };

  // ---- Search ----

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    if (!searchQuery.trim() || !userId) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const results = await searchUsersByHandle(searchQuery, userId);
        setSearchResults(results);
      } catch (err) {
        console.error("[Friends] Search error:", err);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery, userId]);

  const friendUidSet = new Set(friends.map((f) => f.friendUid));
  const outgoingUidSet = new Set(outgoing.map((r) => r.toUserId));
  const incomingByFromUid = new Map(incoming.map((r) => [r.fromUserId, r]));

  const handleSendRequest = async (user: User) => {
    if (!userId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRequestingUids((prev) => new Set(prev).add(user.id));
    try {
      const requestId = await sendFriendRequest(userId, user.id);
      setOutgoing((prev) => [
        ...prev,
        {
          id: requestId,
          fromUserId: userId,
          fromDisplayName: "",
          fromHandle: "",
          toUserId: user.id,
          toDisplayName: user.displayName,
          toHandle: user.handle,
          status: "pending",
          createdAt: new Date().toISOString(),
        },
      ]);
      notifySuccess(toast, `Friend request sent to ${user.displayName}`);
    } catch (err: any) {
      notifyError(toast, err?.message || "Couldn't send friend request. Please try again.");
    } finally {
      setRequestingUids((prev) => {
        const next = new Set(prev);
        next.delete(user.id);
        return next;
      });
    }
  };

  // ---- Requests ----

  const handleAccept = async (request: FriendRequest) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await acceptFriendRequest(request);
      setIncoming((prev) => prev.filter((r) => r.id !== request.id));
      await loadAll();
      notifySuccess(toast, `You and ${request.fromDisplayName} are now friends`);
    } catch (err: any) {
      notifyError(toast, err?.message || "Couldn't accept that request. Please try again.");
    }
  };

  const handleDecline = async (request: FriendRequest) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await declineFriendRequest(request.id);
      setIncoming((prev) => prev.filter((r) => r.id !== request.id));
    } catch (err: any) {
      notifyError(toast, err?.message || "Couldn't decline that request. Please try again.");
    }
  };

  const handleCancelRequest = async (request: FriendRequest) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await cancelFriendRequest(request.id);
      setOutgoing((prev) => prev.filter((r) => r.id !== request.id));
    } catch (err: any) {
      notifyError(toast, err?.message || "Couldn't cancel that request. Please try again.");
    }
  };

  // ---- My Campground tagging ----

  const handleToggleCampground = async (friend: Friend) => {
    if (!userId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextValue = !friend.inCampground;
    setFriends((prev) =>
      prev.map((f) => (f.friendUid === friend.friendUid ? { ...f, inCampground: nextValue } : f))
    );
    try {
      if (nextValue) {
        await addToCampground(userId, friend);
      } else {
        await removeFromCampground(userId, friend.friendUid);
      }
    } catch (err: any) {
      // Revert on failure
      setFriends((prev) =>
        prev.map((f) => (f.friendUid === friend.friendUid ? { ...f, inCampground: !nextValue } : f))
      );
      notifyError(toast, err?.message || "Couldn't update My Campground. Please try again.");
    }
  };

  const confirmRemoveFriend = async () => {
    const friend = pendingRemoveFriend;
    setPendingRemoveFriend(null);
    if (!friend || !userId) return;
    try {
      await removeFriend(userId, friend.friendUid);
      setFriends((prev) => prev.filter((f) => f.friendUid !== friend.friendUid));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      notifyError(toast, err?.message || "Couldn't remove that friend. Please try again.");
    }
  };

  // ---- Guests ----

  const handleAddGuest = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("AddCamper");
  };

  const handleGuestPress = (guest: CampgroundContact) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("EditCamper", { contactId: guest.id });
  };

  const handleInviteGuest = (guest: CampgroundContact) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedGuest(guest);
    setShowInviteSheet(true);
  };

  const confirmDeleteGuest = async () => {
    const guest = pendingDeleteGuest;
    setPendingDeleteGuest(null);
    if (!guest) return;
    try {
      await deleteCampgroundContact(guest.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setGuests((prev) => prev.filter((g) => g.id !== guest.id));
    } catch (err) {
      console.error("[Friends] Delete guest failed:", err);
      notifyError(toast, "Failed to remove guest");
    }
  };

  const handleViewProfile = (uid: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("MyCampsite", { userId: uid });
  };

  if (loading) {
    return (
      <View className="flex-1" style={{ backgroundColor: PARCHMENT }}>
        <ModalHeader title="Friends" showTitle />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={DEEP_FOREST} />
          <Text className="mt-4" style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}>
            Loading your friends...
          </Text>
        </View>
      </View>
    );
  }

  if (error && !auth.currentUser) {
    return (
      <View className="flex-1" style={{ backgroundColor: PARCHMENT }}>
        <ModalHeader title="Friends" showTitle />
        <View className="flex-1 items-center justify-center px-5">
          <Ionicons name="people-outline" size={64} color={EARTH_GREEN} />
          <Text
            className="mt-4 text-center text-lg"
            style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_PRIMARY_STRONG }}
          >
            Sign in to view your friends
          </Text>
          <Pressable
            onPress={() => navigation.navigate("Auth")}
            className="mt-6 px-6 py-3 rounded-xl active:opacity-90"
            style={{ backgroundColor: DEEP_FOREST }}
          >
            <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: PARCHMENT }}>Sign In</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (error && auth.currentUser) {
    return (
      <View className="flex-1" style={{ backgroundColor: PARCHMENT }}>
        <ModalHeader title="Friends" showTitle />
        <View className="flex-1 items-center justify-center px-5">
          <Ionicons name="alert-circle-outline" size={64} color={EARTH_GREEN} />
          <Text
            className="mt-4 text-center text-lg"
            style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_PRIMARY_STRONG }}
          >
            Couldn't load your friends
          </Text>
          <Text className="mt-2 text-center" style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}>
            {error}
          </Text>
          <Pressable
            onPress={() => loadAll()}
            className="mt-6 px-6 py-3 rounded-xl active:opacity-90"
            style={{ backgroundColor: DEEP_FOREST }}
          >
            <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: PARCHMENT }}>Try Again</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const campgroundFriends = friends.filter((f) => f.inCampground);
  const plainFriends = friends.filter((f) => !f.inCampground);
  const isSearchMode = searchQuery.trim().length > 0;

  return (
    <View className="flex-1" style={{ backgroundColor: PARCHMENT }}>
      <ModalHeader title="Friends" showTitle onInfoPress={openModal} />

      {/* Search bar - always visible, finds people already on the app */}
      <View className="px-5 pt-4 pb-2">
        <View
          className="flex-row items-center px-3 rounded-xl border"
          style={{ backgroundColor: CARD_BACKGROUND_LIGHT, borderColor: BORDER_SOFT }}
        >
          <Ionicons name="search" size={18} color={TEXT_MUTED} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Find friends by @handle"
            placeholderTextColor={TEXT_MUTED}
            autoCapitalize="none"
            autoCorrect={false}
            className="flex-1 py-3 px-2"
            style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_PRIMARY_STRONG }}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={TEXT_MUTED} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={DEEP_FOREST} />}
      >
        {isSearchMode ? (
          <View className="px-5 pb-8">
            {searching ? (
              <View className="py-8 items-center">
                <ActivityIndicator color={DEEP_FOREST} />
              </View>
            ) : searchResults.length === 0 ? (
              <View className="py-8 items-center">
                <Text style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}>
                  No campers found for "{searchQuery}"
                </Text>
              </View>
            ) : (
              searchResults.map((user) => {
                const isFriend = friendUidSet.has(user.id);
                const isPending = outgoingUidSet.has(user.id);
                const incomingRequest = incomingByFromUid.get(user.id);
                return (
                  <View
                    key={user.id}
                    className="flex-row items-center p-3 mb-2 rounded-xl border"
                    style={{ backgroundColor: CARD_BACKGROUND_LIGHT, borderColor: BORDER_SOFT }}
                  >
                    <Pressable
                      onPress={() => handleViewProfile(user.id)}
                      className="flex-row items-center flex-1"
                    >
                      <Avatar uri={user.photoURL} name={user.displayName} />
                      <View className="ml-3 flex-1">
                        <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_PRIMARY_STRONG }}>
                          {user.displayName}
                        </Text>
                        <Text style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY, fontSize: 13 }}>
                          @{user.handle}
                        </Text>
                      </View>
                    </Pressable>

                    {isFriend ? (
                      <View className="px-3 py-2 rounded-lg" style={{ backgroundColor: BORDER_SOFT }}>
                        <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_SECONDARY, fontSize: 13 }}>
                          Friends
                        </Text>
                      </View>
                    ) : incomingRequest ? (
                      <Pressable
                        onPress={() => handleAccept(incomingRequest)}
                        className="px-3 py-2 rounded-lg active:opacity-90"
                        style={{ backgroundColor: EARTH_GREEN }}
                      >
                        <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: PARCHMENT, fontSize: 13 }}>
                          Accept
                        </Text>
                      </Pressable>
                    ) : isPending ? (
                      <View className="px-3 py-2 rounded-lg border" style={{ borderColor: BORDER_SOFT }}>
                        <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_SECONDARY, fontSize: 13 }}>
                          Pending
                        </Text>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => handleSendRequest(user)}
                        disabled={requestingUids.has(user.id)}
                        className="px-3 py-2 rounded-lg active:opacity-90"
                        style={{ backgroundColor: DEEP_FOREST }}
                      >
                        {requestingUids.has(user.id) ? (
                          <ActivityIndicator size="small" color={PARCHMENT} />
                        ) : (
                          <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: PARCHMENT, fontSize: 13 }}>
                            Add Friend
                          </Text>
                        )}
                      </Pressable>
                    )}
                  </View>
                );
              })
            )}
          </View>
        ) : (
          <>
            {/* Incoming Requests */}
            {incoming.length > 0 && (
              <View className="px-5 pt-2 pb-4">
                <Text className="mb-3" style={{ fontFamily: "Raleway_700Bold", fontSize: 16, color: TEXT_PRIMARY_STRONG }}>
                  Friend Requests
                </Text>
                {incoming.map((request) => (
                  <View
                    key={request.id}
                    className="flex-row items-center p-3 mb-2 rounded-xl border"
                    style={{ backgroundColor: CARD_BACKGROUND_LIGHT, borderColor: BORDER_SOFT }}
                  >
                    <Avatar uri={request.fromAvatarUrl} name={request.fromDisplayName} />
                    <View className="ml-3 flex-1">
                      <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_PRIMARY_STRONG }}>
                        {request.fromDisplayName}
                      </Text>
                      <Text style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY, fontSize: 13 }}>
                        @{request.fromHandle}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => handleDecline(request)}
                      hitSlop={8}
                      className="w-9 h-9 rounded-full items-center justify-center active:opacity-70 mr-2"
                      style={{ backgroundColor: "#fff5f5" }}
                      accessibilityLabel="Decline"
                    >
                      <Ionicons name="close" size={18} color={RUST} />
                    </Pressable>
                    <Pressable
                      onPress={() => handleAccept(request)}
                      hitSlop={8}
                      className="w-9 h-9 rounded-full items-center justify-center active:opacity-70"
                      style={{ backgroundColor: `${EARTH_GREEN}20` }}
                      accessibilityLabel="Accept"
                    >
                      <Ionicons name="checkmark" size={18} color={EARTH_GREEN} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            {/* Sent Requests */}
            {outgoing.length > 0 && (
              <View className="px-5 pt-2 pb-4">
                <Text className="mb-3" style={{ fontFamily: "Raleway_700Bold", fontSize: 16, color: TEXT_PRIMARY_STRONG }}>
                  Sent Requests
                </Text>
                {outgoing.map((request) => (
                  <View
                    key={request.id}
                    className="flex-row items-center p-3 mb-2 rounded-xl border"
                    style={{ backgroundColor: CARD_BACKGROUND_LIGHT, borderColor: BORDER_SOFT }}
                  >
                    <Avatar uri={request.toAvatarUrl} name={request.toDisplayName} />
                    <View className="ml-3 flex-1">
                      <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_PRIMARY_STRONG }}>
                        {request.toDisplayName}
                      </Text>
                      <Text style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY, fontSize: 13 }}>
                        @{request.toHandle}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => handleCancelRequest(request)}
                      className="px-3 py-2 rounded-lg border"
                      style={{ borderColor: BORDER_SOFT }}
                    >
                      <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_SECONDARY, fontSize: 13 }}>
                        Cancel
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            {/* My Campground */}
            <View className="px-5 pt-2 pb-4">
              <View className="flex-row items-baseline justify-between mb-1">
                <Text style={{ fontFamily: "Raleway_700Bold", fontSize: 16, color: TEXT_PRIMARY_STRONG }}>
                  My Campground
                </Text>
                <Pressable onPress={() => setShowWhatIsThis(true)} className="active:opacity-70">
                  <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: EARTH_GREEN, fontSize: 13, textDecorationLine: "underline" }}>
                    What is this?
                  </Text>
                </Pressable>
              </View>
              <Text className="mb-3" style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY, fontSize: 13 }}>
                The friends you actually go camping with
              </Text>

              {campgroundFriends.length === 0 ? (
                <View className="p-5 rounded-xl items-center border" style={{ backgroundColor: CARD_BACKGROUND_LIGHT, borderColor: BORDER_SOFT }}>
                  <Ionicons name="bonfire-outline" size={32} color={EARTH_GREEN} />
                  <Text className="mt-2 text-center" style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY, fontSize: 13 }}>
                    Tag a friend below to add them to your campground.
                  </Text>
                </View>
              ) : (
                campgroundFriends.map((friend) => (
                  <FriendRow
                    key={friend.friendUid}
                    friend={friend}
                    onPress={() => handleViewProfile(friend.friendUid)}
                    onToggleCampground={() => handleToggleCampground(friend)}
                    onRemove={() => setPendingRemoveFriend(friend)}
                  />
                ))
              )}
            </View>

            {/* Friends (not tagged into My Campground) */}
            <View className="px-5 pt-2 pb-4">
              <Text className="mb-3" style={{ fontFamily: "Raleway_700Bold", fontSize: 16, color: TEXT_PRIMARY_STRONG }}>
                Friends
              </Text>

              {plainFriends.length === 0 ? (
                <View className="p-5 rounded-xl items-center border" style={{ backgroundColor: CARD_BACKGROUND_LIGHT, borderColor: BORDER_SOFT }}>
                  <Ionicons name="people-outline" size={32} color={EARTH_GREEN} />
                  <Text className="mt-2 text-center" style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY, fontSize: 13 }}>
                    Search above to find friends already on the app.
                  </Text>
                </View>
              ) : (
                plainFriends.map((friend) => (
                  <FriendRow
                    key={friend.friendUid}
                    friend={friend}
                    onPress={() => handleViewProfile(friend.friendUid)}
                    onToggleCampground={() => handleToggleCampground(friend)}
                    onRemove={() => setPendingRemoveFriend(friend)}
                  />
                ))
              )}
            </View>

            {/* Guests - people without accounts */}
            <View className="px-5 pt-2 pb-6">
              <Text className="mb-1" style={{ fontFamily: "Raleway_700Bold", fontSize: 16, color: TEXT_PRIMARY_STRONG }}>
                Guests
              </Text>
              <Text className="mb-3" style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY, fontSize: 13 }}>
                Kids, pets, or camping buddies who aren't on the app yet
              </Text>

              <Pressable
                onPress={handleAddGuest}
                className="flex-row items-center justify-center py-3 rounded-xl active:opacity-90 mb-3"
                style={{ backgroundColor: CARD_BACKGROUND_LIGHT, borderWidth: 1, borderColor: BORDER_SOFT, borderStyle: "dashed" }}
              >
                <Ionicons name="person-add-outline" size={18} color={EARTH_GREEN} />
                <Text className="ml-2" style={{ fontFamily: "SourceSans3_600SemiBold", color: EARTH_GREEN }}>
                  Add Guest
                </Text>
              </Pressable>

              {guests.map((guest) => (
                <View
                  key={guest.id}
                  className="mb-3 p-4 rounded-xl border"
                  style={{ backgroundColor: CARD_BACKGROUND_LIGHT, borderColor: BORDER_SOFT }}
                >
                  <Pressable onPress={() => handleGuestPress(guest)} className="active:opacity-70">
                    <View className="flex-row items-start justify-between">
                      <View className="flex-1">
                        <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_PRIMARY_STRONG, fontSize: 16 }}>
                          {guest.contactName}
                        </Text>
                        {guest.contactEmail ? (
                          <Text className="mt-1" style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}>
                            {guest.contactEmail}
                          </Text>
                        ) : null}
                        {guest.contactNote ? (
                          <Text className="mt-2 text-sm" style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_MUTED }}>
                            {guest.contactNote}
                          </Text>
                        ) : null}
                      </View>
                      <Pressable
                        onPress={() => setPendingDeleteGuest(guest)}
                        hitSlop={8}
                        className="p-1.5 -mr-1.5 active:opacity-60"
                        accessibilityLabel={`Remove ${guest.contactName}`}
                      >
                        <Ionicons name="trash-outline" size={18} color={TEXT_MUTED} />
                      </Pressable>
                      <Ionicons name="chevron-forward" size={20} color={TEXT_MUTED} style={{ marginLeft: 8 }} />
                    </View>
                  </Pressable>

                  <Pressable
                    onPress={() => handleInviteGuest(guest)}
                    className="flex-row items-center justify-center mt-3 py-2 rounded-lg active:opacity-80"
                    style={{ backgroundColor: `${EARTH_GREEN}20`, borderColor: EARTH_GREEN, borderWidth: 1 }}
                  >
                    <Ionicons name="paper-plane" size={16} color={EARTH_GREEN} />
                    <Text className="ml-2" style={{ fontFamily: "SourceSans3_600SemiBold", color: EARTH_GREEN, fontSize: 14 }}>
                      Invite to the App
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {selectedGuest ? (
        <InviteOptionsSheet
          visible={showInviteSheet}
          onClose={() => {
            setShowInviteSheet(false);
            setSelectedGuest(null);
          }}
          contact={selectedGuest}
        />
      ) : null}

      {/* What is My Campground? */}
      <Modal visible={showWhatIsThis} transparent animationType="fade" onRequestClose={() => setShowWhatIsThis(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowWhatIsThis(false)} />
          <View
            className="mx-5 rounded-2xl p-5"
            style={{ backgroundColor: PARCHMENT, marginBottom: insets.bottom + 20, borderColor: BORDER_SOFT, borderWidth: 1 }}
          >
            <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_PRIMARY_STRONG, fontSize: 18 }}>
              What is My Campground?
            </Text>
            <Text className="mt-3" style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY, lineHeight: 20 }}>
              Every friend you add shows up under Friends. My Campground is just the ones you tag as
              people you actually go camping with, so trip planning starts with your closest circle
              instead of your whole friends list.
            </Text>
            <View className="mt-4">
              <Text style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY, lineHeight: 20 }}>
                • Tap the campfire icon on any friend to add or remove the tag.
              </Text>
              <Text style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY, lineHeight: 20, marginTop: 10 }}>
                • Adding people to a trip is a Pro feature - tagging them here is free.
              </Text>
            </View>
            <Pressable
              onPress={() => setShowWhatIsThis(false)}
              className="py-3 rounded-xl items-center active:opacity-70 mt-5"
              style={{ borderColor: BORDER_SOFT, borderWidth: 1 }}
            >
              <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_SECONDARY }}>Got it</Text>
            </Pressable>
          </View>
          <View style={{ height: 12 }} />
        </View>
      </Modal>

      <OnboardingModal visible={showModal} tooltip={currentTooltip} onDismiss={dismissModal} />

      <ConfirmationModal
        visible={!!pendingRemoveFriend}
        title="Remove friend?"
        message={`Remove ${pendingRemoveFriend?.displayName} from your friends? They'll need to send a new request to reconnect.`}
        primary={{ label: "Remove", iconName: "person-remove-outline", onPress: confirmRemoveFriend }}
        secondary={{ label: "Cancel", onPress: () => setPendingRemoveFriend(null) }}
        onClose={() => setPendingRemoveFriend(null)}
      />

      <ConfirmationModal
        visible={!!pendingDeleteGuest}
        title="Remove guest?"
        message={`Are you sure you want to remove ${pendingDeleteGuest?.contactName}?`}
        primary={{ label: "Remove", iconName: "trash-outline", onPress: confirmDeleteGuest }}
        secondary={{ label: "Cancel", onPress: () => setPendingDeleteGuest(null) }}
        onClose={() => setPendingDeleteGuest(null)}
      />
    </View>
  );
}

function FriendRow({
  friend,
  onPress,
  onToggleCampground,
  onRemove,
}: {
  friend: Friend;
  onPress: () => void;
  onToggleCampground: () => void;
  onRemove: () => void;
}) {
  return (
    <View
      className="flex-row items-center p-3 mb-2 rounded-xl border"
      style={{ backgroundColor: CARD_BACKGROUND_LIGHT, borderColor: BORDER_SOFT }}
    >
      <Pressable onPress={onPress} className="flex-row items-center flex-1">
        <Avatar uri={friend.avatarUrl} name={friend.displayName} />
        <View className="ml-3 flex-1">
          <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_PRIMARY_STRONG }}>
            {friend.displayName}
          </Text>
          <Text style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY, fontSize: 13 }}>
            @{friend.handle}
          </Text>
        </View>
      </Pressable>

      <Pressable
        onPress={onToggleCampground}
        hitSlop={8}
        className="w-9 h-9 rounded-full items-center justify-center active:opacity-70 mr-1"
        style={{ backgroundColor: friend.inCampground ? `${EARTH_GREEN}20` : "transparent" }}
        accessibilityLabel={friend.inCampground ? "Remove from My Campground" : "Add to My Campground"}
      >
        <Ionicons name="bonfire" size={18} color={friend.inCampground ? EARTH_GREEN : TEXT_MUTED} />
      </Pressable>

      <Pressable
        onPress={onRemove}
        hitSlop={8}
        className="w-9 h-9 rounded-full items-center justify-center active:opacity-70"
        accessibilityLabel="Remove friend"
      >
        <Ionicons name="close" size={18} color={TEXT_MUTED} />
      </Pressable>
    </View>
  );
}
