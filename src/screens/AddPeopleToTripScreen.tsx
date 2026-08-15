/**
 * Add People to Trip Modal
 * Multi-select contacts from My Campground
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Share,
} from "react-native";
import { useNavigation, useRoute, RouteProp, useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { auth } from "../config/firebase";
import { getCampgroundContacts, createLinkedContactFromFriend } from "../services/campgroundContactsService";
import { addTripParticipantsWithRoles } from "../services/tripParticipantsService";
import { getFriends } from "../services/friendsService";
import {
  createTripShareInvite,
  generateTripShareMessage,
  TripSharePermission,
} from "../services/tripShareInviteService";
import { CampgroundContact } from "../types/campground";
import { Friend } from "../types/friends";
import { RootStackParamList, RootStackNavigationProp } from "../navigation/types";
import { useTripsStore } from "../state/tripsStore";
import ModalHeader from "../components/ModalHeader";
import { requirePro } from "../utils/gating";
import AccountRequiredModal from "../components/AccountRequiredModal";
import UpsellModal from "../components/UpsellModal";
import { useUpsellStore, UPSELL_COPY } from "../state/upsellStore";
import { useUserStore } from "../state/userStore";
import { trackUpsellModalViewed, trackUpsellCtaClicked } from "../services/analyticsService";
import { PaywallPlacement } from "../config/paywallPlacements";
import {
  DEEP_FOREST,
  EARTH_GREEN,
  PARCHMENT,
  CARD_BACKGROUND_LIGHT,
  BORDER_SOFT,
  TEXT_PRIMARY_STRONG,
  TEXT_SECONDARY,
  TEXT_MUTED,
} from "../constants/colors";

// A trip roster entry: either an existing campgroundContacts record
// (guest or already-linked friend) or a pure Friend with no contact
// record yet - lazily provisioned into one on submit, since the trip
// roster system (TripParticipant) is keyed on campgroundContactId.
type RosterItem =
  | { id: string; kind: "contact"; contact: CampgroundContact }
  | { id: string; kind: "friend"; friend: Friend };

export default function AddPeopleToTripScreen() {
  const navigation = useNavigation<RootStackNavigationProp>();
  const route = useRoute<RouteProp<RootStackParamList, "AddPeopleToTrip">>();
  const { tripId } = route.params;

  const trip = useTripsStore((s) => s.getTripById(tripId));
  const updateTrip = useTripsStore((s) => s.updateTrip);

  const [contacts, setContacts] = useState<CampgroundContact[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Roster item ids (matches selectedIds' keys) granted edit access instead
  // of the default view-only. Owner decides per person - see
  // setMemberEditPermission in tripsStore.ts and editorIds on Trip.
  const [editPermissionIds, setEditPermissionIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Friends already represented by a linked contact record show once, as
  // that contact - not twice.
  const linkedFriendUids = new Set(contacts.map((c) => c.contactUserId).filter(Boolean));
  const roster: RosterItem[] = [
    ...contacts.map((contact): RosterItem => ({ id: contact.id, kind: "contact", contact })),
    ...friends
      .filter((f) => !linkedFriendUids.has(f.friendUid))
      .map((friend): RosterItem => ({ id: `friend:${friend.friendUid}`, kind: "friend", friend })),
  ];

  // My Campground tagging is meant to make trip planning "start with your
  // closest circle instead of your whole friends list" (see the "What is
  // this?" explainer on the Friends screen) - so lead with tagged friends
  // here instead of mixing everyone together in whatever order they loaded.
  const isCampgroundTagged = (item: RosterItem) => item.kind === "friend" && item.friend.inCampground;
  const campgroundCount = roster.filter(isCampgroundTagged).length;
  const sortedRoster =
    campgroundCount > 0 && campgroundCount < roster.length
      ? [...roster.filter(isCampgroundTagged), ...roster.filter((item) => !isCampgroundTagged(item))]
      : roster;

  // Gating modal state
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);

  // Upsell state
  const { hasUsedFreeTrip } = useUserStore();
  const { canShowSoftModal, markInviteModalShown, recordModalDismissal } = useUpsellStore();

  useEffect(() => {
    loadRoster();
  }, []);

  // Reload when screen comes back into focus (e.g., after adding a new guest)
  useFocusEffect(
    useCallback(() => {
      loadRoster();
    }, [])
  );

  const loadRoster = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert("Error", "You must be signed in");
      navigation.goBack();
      return;
    }

    try {
      const [contactsData, friendsData] = await Promise.all([
        getCampgroundContacts(user.uid),
        getFriends(user.uid),
      ]);
      setContacts(contactsData);
      setFriends(friendsData);
    } catch (error: any) {
      console.error("Error loading trip roster:", error);
      Alert.alert("Error", "Failed to load your friends and guests");
    } finally {
      setLoading(false);
    }
  };

  const toggleItem = (itemId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
        // Deselecting someone also clears any edit permission they'd been
        // given, so it doesn't linger if they get re-selected later.
        setEditPermissionIds((editPrev) => {
          const editSet = new Set(editPrev);
          editSet.delete(itemId);
          return editSet;
        });
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  const toggleEditPermission = (itemId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditPermissionIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  const handleSubmit = async () => {
    if (selectedIds.size === 0) {
      Alert.alert("No Selection", "Please select at least one person to add");
      return;
    }

    // Gate: PRO required to add people to trips
    if (!requirePro({
      openAccountModal: () => setShowAccountModal(true),
      openPaywallModal: (variant) => navigation.navigate("Paywall", { triggerKey: PaywallPlacement.ShareTrip, variant }),
    })) {
      return;
    }

    try {
      setSubmitting(true);
      const user = auth.currentUser;
      if (!user) throw new Error("You must be signed in");

      const selectedItems = roster.filter((item) => selectedIds.has(item.id));

      // Pure Friends (no existing campgroundContacts record) need one
      // provisioned first - the trip roster is keyed on
      // campgroundContactId, not a bare user id.
      const resolvedContactIds = await Promise.all(
        selectedItems.map((item) =>
          item.kind === "contact"
            ? Promise.resolve(item.contact.id)
            : createLinkedContactFromFriend(user.uid, item.friend.friendUid, item.friend.displayName)
        )
      );

      const participantsWithRoles = resolvedContactIds.map((contactId) => ({
        contactId,
        role: "guest" as const,
      }));

      const tripStartDate = trip?.startDate ? new Date(trip.startDate) : new Date();
      await addTripParticipantsWithRoles(tripId, participantsWithRoles, tripStartDate);

      // Grant read access to any added person who is a registered app
      // user (either an already-linked contact, or a Friend - Friends are
      // always registered users by definition). Guests without an
      // account have no uid to grant access to and just stay in the
      // roster added above.
      const linkedUserIds = selectedItems
        .map((item) => (item.kind === "friend" ? item.friend.friendUid : item.contact.contactUserId))
        .filter((uid): uid is string => !!uid);

      if (linkedUserIds.length > 0 && trip) {
        const existingMemberIds = trip.memberIds || [];
        const newMemberIds = Array.from(new Set([...existingMemberIds, ...linkedUserIds]));

        // Of the people just added, which ones were granted edit access
        // (owner's per-person choice) rather than the view-only default?
        const newEditorUids = selectedItems
          .filter((item) => editPermissionIds.has(item.id))
          .map((item) => (item.kind === "friend" ? item.friend.friendUid : item.contact.contactUserId))
          .filter((uid): uid is string => !!uid);

        const existingEditorIds = trip.editorIds || [];
        const newEditorIds = Array.from(new Set([...existingEditorIds, ...newEditorUids]));

        const updates: { memberIds?: string[]; editorIds?: string[] } = {};
        if (newMemberIds.length !== existingMemberIds.length) {
          updates.memberIds = newMemberIds;
        }
        if (newEditorIds.length !== existingEditorIds.length) {
          updates.editorIds = newEditorIds;
        }
        if (Object.keys(updates).length > 0) {
          await updateTrip(tripId, updates);
        }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      // Check if we should show invite upsell modal
      if (!hasUsedFreeTrip && canShowSoftModal("invite", false)) {
        setShowInviteModal(true);
        markInviteModalShown();
        trackUpsellModalViewed("invite");
      } else {
        navigation.goBack();
      }
    } catch (error: any) {
      console.error("Error adding participants:", error);
      Alert.alert("Error", error.message || "Failed to add people to trip");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddNewPerson = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Navigate to AddCamper screen to add a new person to campground
    navigation.navigate("AddCamper" as any);
  };

  const [sharingLink, setSharingLink] = useState(false);

  const handleShareViaLink = () => {
    if (!requirePro({
      openAccountModal: () => setShowAccountModal(true),
      openPaywallModal: (variant) => navigation.navigate("Paywall", { triggerKey: PaywallPlacement.ShareTrip, variant }),
    })) {
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      "Share trip link",
      "What can they do with this trip?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "View only", onPress: () => createAndShareInvite("view") },
        { text: "Can plan and edit", onPress: () => createAndShareInvite("edit") },
      ]
    );
  };

  const createAndShareInvite = async (permission: TripSharePermission) => {
    const user = auth.currentUser;
    if (!user || !trip) return;

    try {
      setSharingLink(true);
      const inviterName = user.displayName || "A friend";
      const result = await createTripShareInvite({
        tripId,
        inviterName,
        permission,
      });

      const message = generateTripShareMessage(inviterName, trip.name, result.token, permission);
      await Share.share({ message });
    } catch (error: any) {
      console.error("Error sharing trip invite:", error);
      Alert.alert("Error", error.message || "Failed to create share link");
    } finally {
      setSharingLink(false);
    }
  };

  if (loading) {
    return (
      <View className="flex-1" style={{ backgroundColor: PARCHMENT }}>
        <ModalHeader title="Add People" showTitle />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={DEEP_FOREST} />
          <Text className="mt-4" style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}>
            Loading your friends and guests...
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: PARCHMENT }}>
      <ModalHeader
        title="Add People"
        showTitle
        rightAction={{
          icon: "add",
          onPress: handleAddNewPerson,
        }}
      />

      <ScrollView className="flex-1 px-5 pt-5">
        {roster.length === 0 ? (
          <View className="py-12 items-center">
            <Ionicons name="people-outline" size={64} color={BORDER_SOFT} />
            <Text
              className="mt-4 text-center mb-4"
              style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_MUTED }}
            >
              No friends or guests yet. Add some people first.
            </Text>
            <Pressable
              onPress={() => {
                navigation.goBack();
                navigation.navigate("MyCampground");
              }}
              className="px-6 py-3 rounded-xl active:opacity-90"
              style={{ backgroundColor: DEEP_FOREST }}
            >
              <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: PARCHMENT }}>
                Go to Friends
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text
              className="mb-4"
              style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}
            >
              Select friends or guests to add to this trip
            </Text>

            {sortedRoster.map((item, index) => {
              const isSelected = selectedIds.has(item.id);
              const title = item.kind === "contact" ? item.contact.contactName : item.friend.displayName;
              const subtitle = item.kind === "contact" ? item.contact.contactEmail : `@${item.friend.handle}`;
              const showSectionHeader = campgroundCount > 0 && campgroundCount < sortedRoster.length &&
                (index === 0 || index === campgroundCount);
              return (
                <React.Fragment key={item.id}>
                  {showSectionHeader && (
                    <Text
                      className="mb-2 mt-1 text-xs uppercase"
                      style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_MUTED, letterSpacing: 0.5 }}
                    >
                      {index === 0 ? "My Campground" : "More Friends & Guests"}
                    </Text>
                  )}
                <Pressable
                  onPress={() => toggleItem(item.id)}
                  className="mb-3 p-4 rounded-xl border active:opacity-70"
                  style={{
                    backgroundColor: isSelected ? EARTH_GREEN : CARD_BACKGROUND_LIGHT,
                    borderColor: isSelected ? EARTH_GREEN : BORDER_SOFT,
                  }}
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1 mr-3">
                      <View className="flex-row items-center">
                        <Text
                          className="text-lg"
                          style={{
                            fontFamily: "SourceSans3_600SemiBold",
                            color: isSelected ? PARCHMENT : TEXT_PRIMARY_STRONG,
                          }}
                        >
                          {title}
                        </Text>
                        {item.kind === "friend" && (
                          <View
                            className="ml-2 px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: isSelected ? "rgba(255,255,255,0.25)" : `${EARTH_GREEN}20` }}
                          >
                            <Text
                              style={{
                                fontFamily: "SourceSans3_600SemiBold",
                                fontSize: 11,
                                color: isSelected ? PARCHMENT : EARTH_GREEN,
                              }}
                            >
                              Friend
                            </Text>
                          </View>
                        )}
                      </View>

                      {subtitle && (
                        <Text
                          className="mt-1"
                          style={{
                            fontFamily: "SourceSans3_400Regular",
                            color: isSelected ? PARCHMENT : TEXT_SECONDARY,
                          }}
                        >
                          {subtitle}
                        </Text>
                      )}
                    </View>

                    <View
                      className="w-6 h-6 rounded border-2 items-center justify-center"
                      style={{
                        borderColor: isSelected ? PARCHMENT : BORDER_SOFT,
                        backgroundColor: isSelected ? PARCHMENT : "transparent",
                      }}
                    >
                      {isSelected && <Ionicons name="checkmark" size={16} color={EARTH_GREEN} />}
                    </View>
                  </View>

                  {isSelected && (
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        toggleEditPermission(item.id);
                      }}
                      className="flex-row items-center mt-3 pt-3"
                      style={{ borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.25)" }}
                      accessibilityRole="button"
                      accessibilityLabel={editPermissionIds.has(item.id) ? "Can edit this trip" : "Can view this trip"}
                    >
                      <View
                        className="w-5 h-5 rounded items-center justify-center mr-2"
                        style={{
                          borderWidth: 1.5,
                          borderColor: PARCHMENT,
                          backgroundColor: editPermissionIds.has(item.id) ? PARCHMENT : "transparent",
                        }}
                      >
                        {editPermissionIds.has(item.id) && (
                          <Ionicons name="checkmark" size={13} color={EARTH_GREEN} />
                        )}
                      </View>
                      <Text
                        style={{
                          fontFamily: "SourceSans3_400Regular",
                          fontSize: 13,
                          color: PARCHMENT,
                        }}
                      >
                        {editPermissionIds.has(item.id)
                          ? "Can plan and edit this trip"
                          : "Can view only — tap to allow editing"}
                      </Text>
                    </Pressable>
                  )}
                </Pressable>
                </React.Fragment>
              );
            })}

            <Pressable
              onPress={handleSubmit}
              disabled={selectedIds.size === 0 || submitting}
              className="mt-4 mb-8 py-3 rounded-lg active:opacity-90"
              style={{
                backgroundColor: selectedIds.size > 0 ? DEEP_FOREST : BORDER_SOFT,
              }}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={PARCHMENT} />
              ) : (
                <Text
                  className="text-center"
                  style={{ fontFamily: "SourceSans3_600SemiBold", color: PARCHMENT }}
                >
                  {selectedIds.size > 0
                    ? `Add ${selectedIds.size} ${selectedIds.size === 1 ? "person" : "people"} to trip`
                    : "Select people to add"}
                </Text>
              )}
            </Pressable>

            <Pressable
              onPress={handleShareViaLink}
              disabled={sharingLink}
              className="mt-3 mb-8 py-3 rounded-lg border active:opacity-70 flex-row items-center justify-center"
              style={{ borderColor: DEEP_FOREST }}
            >
              {sharingLink ? (
                <ActivityIndicator size="small" color={DEEP_FOREST} />
              ) : (
                <>
                  <Ionicons name="link-outline" size={18} color={DEEP_FOREST} style={{ marginRight: 8 }} />
                  <Text
                    style={{ fontFamily: "SourceSans3_600SemiBold", color: DEEP_FOREST }}
                  >
                    Share trip via link
                  </Text>
                </>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>

      {/* Gating Modals */}
      <AccountRequiredModal
        visible={showAccountModal}
        onCreateAccount={() => {
          setShowAccountModal(false);
          navigation.navigate("Auth" as any);
        }}
        onMaybeLater={() => setShowAccountModal(false)}
      />

      {/* Invite Intent Upsell Modal */}
      <UpsellModal
        visible={showInviteModal}
        title={UPSELL_COPY.invite.title}
        body={UPSELL_COPY.invite.body}
        primaryCtaText={UPSELL_COPY.invite.primaryCta}
        secondaryCtaText={UPSELL_COPY.invite.secondaryCta}
        finePrint={UPSELL_COPY.invite.finePrint}
        onPrimaryPress={() => {
          setShowInviteModal(false);
          trackUpsellCtaClicked("invite");
          navigation.goBack();
          navigation.navigate("Paywall", { triggerKey: PaywallPlacement.ShareTrip });
        }}
        onSecondaryPress={() => {
          setShowInviteModal(false);
          recordModalDismissal();
          navigation.goBack();
        }}
        onDismiss={() => {
          setShowInviteModal(false);
          recordModalDismissal();
          navigation.goBack();
        }}
      />
    </View>
  );
}
