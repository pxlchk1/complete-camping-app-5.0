/**
 * WitnessRequestsScreen
 * 
 * Displays incoming badge stamp requests for the current user to approve.
 * Users can view the badge details and approve or deny the request.
 */

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Image,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { auth, db } from "../config/firebase";
import { doc, getDoc } from "firebase/firestore";
import { RootStackParamList } from "../navigation/types";
import {
  getPendingClaimsForWitness,
  approveBadgeClaim,
  denyBadgeClaim,
  getBadgeDefinition,
} from "../services/meritBadgesService";
import { resolveBadgeImage, deriveImageKey } from "../assets/images/merit_badges/resolveBadgeImage";
import { BadgeClaim, BadgeDefinition, BADGE_COLORS } from "../types/badges";
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
import ModalHeader from "../components/ModalHeader";

type WitnessRequestsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface ClaimWithBadge extends BadgeClaim {
  badge?: BadgeDefinition;
  claimantName?: string;
  claimantAvatarUrl?: string;
}

export default function WitnessRequestsScreen() {
  const navigation = useNavigation<WitnessRequestsScreenNavigationProp>();
  const insets = useSafeAreaInsets();

  const [claims, setClaims] = useState<ClaimWithBadge[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
  // Claim pending a decline confirmation — lets the witness optionally
  // explain why, instead of "Not Yet" being a silent, unexplained reject.
  const [declineTarget, setDeclineTarget] = useState<ClaimWithBadge | null>(null);
  const [declineReason, setDeclineReason] = useState("");

  const userId = auth.currentUser?.uid;

  useFocusEffect(
    useCallback(() => {
      loadClaims();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId])
  );

  const loadClaims = async () => {
    if (!userId) return;

    if (!refreshing) {
      setLoading(true);
    }
    setError(null);

    try {
      const pendingClaims = await getPendingClaimsForWitness(userId);

      // Fetch badge details and the claimant's profile for each claim.
      // Previously the claimant's name/photo were never fetched at all —
      // a witness could see WHICH badge was being requested but not WHO
      // was asking, which matters for a social approval flow.
      const claimsWithBadges: ClaimWithBadge[] = await Promise.all(
        pendingClaims.map(async (claim) => {
          const [badge, claimantProfile] = await Promise.all([
            getBadgeDefinition(claim.badgeId).catch(() => null),
            getDoc(doc(db, "profiles", claim.claimantUserId)).catch(() => null),
          ]);
          const profileData = claimantProfile?.data();
          return {
            ...claim,
            badge: badge || undefined,
            claimantName: profileData?.displayName || "A fellow camper",
            claimantAvatarUrl: profileData?.avatarUrl,
          };
        })
      );

      setClaims(claimsWithBadges);
    } catch (err) {
      console.error("[WitnessRequests] Error loading claims:", err);
      setError("Failed to load requests");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadClaims();
  };

  const handleApprove = async (claimId: string) => {
    if (!userId) return;

    setProcessingId(claimId);

    try {
      await approveBadgeClaim(claimId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      // Remove from list
      setClaims((prev) => prev.filter((c) => c.id !== claimId));
    } catch (err) {
      console.error("[WitnessRequests] Error approving claim:", err);
      setError("Failed to approve request");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setProcessingId(null);
    }
  };

  const handleDeny = async (claimId: string, reason?: string) => {
    if (!userId) return;

    setProcessingId(claimId);

    try {
      await denyBadgeClaim(claimId, userId, reason);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

      // Remove from list
      setClaims((prev) => prev.filter((c) => c.id !== claimId));
    } catch (err) {
      console.error("[WitnessRequests] Error denying claim:", err);
      setError("Failed to deny request");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setProcessingId(null);
    }
  };

  const confirmDecline = () => {
    if (!declineTarget) return;
    const claimId = declineTarget.id;
    const reason = declineReason;
    setDeclineTarget(null);
    setDeclineReason("");
    handleDeny(claimId, reason);
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return "";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  if (loading && !refreshing) {
    return (
      <View className="flex-1" style={{ backgroundColor: PARCHMENT }}>
        <ModalHeader title="Stamp Requests" />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={DEEP_FOREST} />
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: PARCHMENT }}>
      <ModalHeader title="Stamp Requests" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={DEEP_FOREST}
          />
        }
      >
        {/* Header Info */}
        <View className="px-4 pt-4 pb-2">
          <Text style={{ color: TEXT_SECONDARY }}>
            Fellow campers have asked you to witness and stamp their badges.
          </Text>
        </View>

        {/* Error */}
        {error && (
          <View className="mx-4 mt-2 p-3 rounded-lg" style={{ backgroundColor: "#FEE2E2" }}>
            <Text style={{ color: "#DC2626" }}>{error}</Text>
          </View>
        )}

        {/* Empty State */}
        {claims.length === 0 && (
          <View className="mx-4 mt-8 p-8 rounded-xl items-center" style={{ backgroundColor: CARD_BACKGROUND_LIGHT }}>
            <View
              className="w-16 h-16 rounded-full items-center justify-center mb-4"
              style={{ backgroundColor: EARTH_GREEN + "20" }}
            >
              <Ionicons name="ribbon-outline" size={32} color={EARTH_GREEN} />
            </View>
            <Text className="text-lg font-medium text-center" style={{ color: TEXT_PRIMARY_STRONG }}>
              No Pending Requests
            </Text>
            <Text className="text-center mt-2" style={{ color: TEXT_SECONDARY }}>
              When campers in your network request badge stamps, they will appear here.
            </Text>
          </View>
        )}

        {/* Claims List */}
        {claims.map((claim) => {
          const isProcessing = processingId === claim.id;
          const borderColor = claim.badge?.borderColorKey
            ? BADGE_COLORS[claim.badge.borderColorKey as keyof typeof BADGE_COLORS] || EARTH_GREEN
            : EARTH_GREEN;

          return (
            <View
              key={claim.id}
              className="mx-4 mt-4 rounded-xl overflow-hidden"
              style={{
                backgroundColor: CARD_BACKGROUND_LIGHT,
                borderLeftWidth: 4,
                borderLeftColor: borderColor,
              }}
            >
              {/* Claimant Info — who is actually asking. Previously this
                  screen showed only which badge was being requested, never
                  who was requesting it, which made "Stamp It" an approval
                  of a stranger by default. */}
              <View className="px-4 pt-4 flex-row items-center">
                {claim.claimantAvatarUrl ? (
                  <Image
                    source={{ uri: claim.claimantAvatarUrl }}
                    style={{ width: 28, height: 28, borderRadius: 14 }}
                  />
                ) : (
                  <Ionicons name="person-circle" size={28} color={TEXT_MUTED} />
                )}
                <Text className="text-sm ml-2" style={{ color: TEXT_PRIMARY_STRONG }}>
                  <Text className="font-semibold">{claim.claimantName || "A fellow camper"}</Text> wants a stamp
                </Text>
              </View>

              {/* Badge Info */}
              <Pressable
                className="p-4"
                onPress={() => navigation.navigate("BadgeDetail", { badgeId: claim.badgeId })}
              >
                <View className="flex-row items-center">
                  <View
                    className="w-12 h-12 rounded-full items-center justify-center overflow-hidden"
                    style={{ backgroundColor: borderColor + "20" }}
                  >
                    <Image
                      source={resolveBadgeImage(claim.badge?.imageKey || deriveImageKey(claim.badge?.iconAssetKey))}
                      style={{ width: 48, height: 48, borderRadius: 24 }}
                      resizeMode="cover"
                    />
                  </View>
                  <View className="flex-1 ml-3">
                    <Text className="text-base font-semibold" style={{ color: TEXT_PRIMARY_STRONG }}>
                      {claim.badge?.name || "Badge"}
                    </Text>
                    <Text className="text-sm" style={{ color: TEXT_SECONDARY }}>
                      Requested {formatDate(claim.createdAt)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={TEXT_MUTED} />
                </View>
              </Pressable>

              {/* Divider */}
              <View style={{ height: 1, backgroundColor: BORDER_SOFT }} />

              {/* Photo if provided — previously just a placeholder icon
                  with no onPress, so witnesses could never actually see
                  the evidence photo they were asked to approve or deny. */}
              {claim.photoUrl && (
                <View className="p-4">
                  <Text className="text-sm font-medium mb-2" style={{ color: TEXT_SECONDARY }}>
                    PHOTO EVIDENCE
                  </Text>
                  <Pressable
                    className="h-40 rounded-lg overflow-hidden"
                    style={{ backgroundColor: DEEP_FOREST + "10" }}
                    onPress={() => setPreviewPhotoUrl(claim.photoUrl!)}
                    accessibilityLabel="View photo evidence"
                    accessibilityRole="button"
                  >
                    <Image
                      source={{ uri: claim.photoUrl }}
                      style={{ width: "100%", height: "100%" }}
                      resizeMode="cover"
                    />
                  </Pressable>
                </View>
              )}

              {/* Actions */}
              <View className="flex-row p-4 pt-2">
                <Pressable
                  className="flex-1 py-3 rounded-lg mr-2 items-center"
                  style={{
                    backgroundColor: BORDER_SOFT,
                  }}
                  onPress={() => setDeclineTarget(claim)}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <ActivityIndicator size="small" color={TEXT_SECONDARY} />
                  ) : (
                    <Text className="font-medium" style={{ color: TEXT_SECONDARY }}>
                      Not Yet
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  className="flex-1 py-3 rounded-lg ml-2 items-center"
                  style={{
                    backgroundColor: EARTH_GREEN,
                  }}
                  onPress={() => handleApprove(claim.id)}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <ActivityIndicator size="small" color={PARCHMENT} />
                  ) : (
                    <View className="flex-row items-center">
                      <Ionicons name="checkmark-circle" size={18} color={PARCHMENT} />
                      <Text className="font-medium ml-1" style={{ color: PARCHMENT }}>
                        Stamp It
                      </Text>
                    </View>
                  )}
                </Pressable>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Full-screen photo preview */}
      <Modal
        visible={!!previewPhotoUrl}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewPhotoUrl(null)}
      >
        <Pressable
          className="flex-1 items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.9)" }}
          onPress={() => setPreviewPhotoUrl(null)}
        >
          {previewPhotoUrl && (
            <Image
              source={{ uri: previewPhotoUrl }}
              style={{ width: "100%", height: "80%" }}
              resizeMode="contain"
            />
          )}
          <Pressable
            className="absolute top-14 right-6 w-10 h-10 rounded-full items-center justify-center"
            style={{ backgroundColor: "rgba(255,255,255,0.15)" }}
            onPress={() => setPreviewPhotoUrl(null)}
            accessibilityLabel="Close photo preview"
          >
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Decline confirmation — optional reason, since "Not Yet" with zero
          explanation left the claimant with no idea what to fix. */}
      <Modal
        visible={!!declineTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setDeclineTarget(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1 items-center justify-center px-6"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <View className="w-full rounded-2xl p-5" style={{ backgroundColor: PARCHMENT }}>
            <Text className="text-lg font-semibold mb-1" style={{ color: TEXT_PRIMARY_STRONG }}>
              Not this time?
            </Text>
            <Text className="text-sm mb-3" style={{ color: TEXT_SECONDARY }}>
              {declineTarget?.claimantName || "They"}{"'"}ll be able to try again. Let them know why, if you want.
            </Text>
            <TextInput
              value={declineReason}
              onChangeText={setDeclineReason}
              placeholder="e.g. Didn't see the fire lay in the photo (optional)"
              placeholderTextColor={TEXT_MUTED}
              multiline
              numberOfLines={3}
              className="rounded-xl p-3 mb-4"
              style={{
                backgroundColor: CARD_BACKGROUND_LIGHT,
                borderWidth: 1,
                borderColor: BORDER_SOFT,
                color: TEXT_PRIMARY_STRONG,
                minHeight: 72,
                textAlignVertical: "top",
              }}
            />
            <View className="flex-row">
              <Pressable
                className="flex-1 py-3 rounded-lg mr-2 items-center"
                style={{ backgroundColor: BORDER_SOFT }}
                onPress={() => {
                  setDeclineTarget(null);
                  setDeclineReason("");
                }}
              >
                <Text className="font-medium" style={{ color: TEXT_SECONDARY }}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                className="flex-1 py-3 rounded-lg ml-2 items-center"
                style={{ backgroundColor: DEEP_FOREST }}
                onPress={confirmDecline}
              >
                <Text className="font-medium" style={{ color: PARCHMENT }}>
                  Send
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
