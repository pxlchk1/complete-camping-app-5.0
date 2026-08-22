/**
 * Admin Award Subscriptions Screen
 * Allows admin to grant premium subscriptions to users
 */

import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { auth, db } from "../config/firebase";
import { collection, query, where, getDocs } from "firebase/firestore";
import ModalHeader from "../components/ModalHeader";
import ConfirmationModal from "../components/ConfirmationModal";
import { useToast } from "../components/ToastManager";
import { grantMembership } from "../services/userService";
import { MembershipDuration } from "../types/user";
import {
  PARCHMENT,
  CARD_BACKGROUND_LIGHT,
  BORDER_SOFT,
  TEXT_PRIMARY_STRONG,
  TEXT_SECONDARY,
  TEXT_MUTED,
  EARTH_GREEN,
  DEEP_FOREST,
} from "../constants/colors";

const SUBSCRIPTION_DURATIONS = [
  { id: "1_month", label: "1 Month", months: 1 },
  { id: "3_months", label: "3 Months", months: 3 },
  { id: "6_months", label: "6 Months", months: 6 },
  { id: "1_year", label: "1 Year", months: 12 },
  { id: "lifetime", label: "Lifetime", months: null },
];

export default function AdminSubscriptionsScreen() {
  const { showError, showSuccess } = useToast();
  const [email, setEmail] = useState("");
  const [selectedDuration, setSelectedDuration] = useState("");
  const [loading, setLoading] = useState(false);
  // Previously this granted the subscription immediately on tap, with no
  // confirmation step at all — unlike AdminPhotos/AdminContent, which both
  // gate their destructive actions behind a confirm modal. A mistyped
  // email plus a fat-finger tap could grant free lifetime premium.
  const [pendingGrant, setPendingGrant] = useState<{ userId: string; email: string; duration: typeof SUBSCRIPTION_DURATIONS[number] } | null>(null);

  const handleAwardSubscription = async () => {
    if (!email.trim() || !selectedDuration) {
      showError("Please enter an email and select a duration");
      return;
    }

    const duration = SUBSCRIPTION_DURATIONS.find((d) => d.id === selectedDuration);
    if (!duration) return;

    try {
      setLoading(true);

      // Find user by email
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("email", "==", email.trim().toLowerCase()));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        showError("No user found with that email address");
        return;
      }

      const userDoc = querySnapshot.docs[0];
      setPendingGrant({ userId: userDoc.id, email: email.trim(), duration });
    } catch (error: any) {
      console.error("Error looking up user:", error);
      showError(error.message || "Failed to look up user");
    } finally {
      setLoading(false);
    }
  };

  const confirmAwardSubscription = async () => {
    if (!pendingGrant) return;
    const { userId, email: grantedEmail, duration } = pendingGrant;
    setPendingGrant(null);

    const adminId = auth.currentUser?.uid;
    if (!adminId) {
      showError("You must be signed in as an admin to do this.");
      return;
    }

    try {
      setLoading(true);

      // grantMembership() is the real, fully-wired grant path: it writes
      // membershipTier/membershipExpiresAt to profiles/{uid} (what the
      // Pro-gate and account-status listener actually read), records a
      // membershipGrants entry, and logs an audit action. This previously
      // hand-rolled a Firestore write to the wrong collection (users, not
      // profiles) with field names (subscriptionExpiresAt) nothing ever
      // read, so admins believed they'd granted Pro and nothing unlocked.
      await grantMembership(adminId, userId, duration.id as MembershipDuration);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showSuccess(`${duration.label} premium subscription awarded to ${grantedEmail}`);
      setEmail("");
      setSelectedDuration("");
    } catch (error: any) {
      console.error("Error awarding subscription:", error);
      showError(error.message || "Failed to award subscription");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1" style={{ backgroundColor: PARCHMENT }}>
      <ModalHeader title="Award Subscriptions" showTitle />

      <ScrollView className="flex-1">
        <View className="px-5 pt-5 pb-8">
          {/* Info Card */}
          <View
            className="mb-6 p-4 rounded-xl border"
            style={{ backgroundColor: "#E3F2FD", borderColor: "#2196F3" }}
          >
            <View className="flex-row items-start">
              <Ionicons name="information-circle" size={20} color="#2196F3" style={{ marginRight: 8, marginTop: 2 }} />
              <Text
                className="flex-1 text-sm"
                style={{ fontFamily: "SourceSans3_400Regular", color: "#1565C0" }}
              >
                Award premium subscriptions to users by entering their email address and selecting a duration.
              </Text>
            </View>
          </View>

          {/* User Email Input */}
          <View className="mb-6">
            <Text
              className="mb-2"
              style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_PRIMARY_STRONG }}
            >
              User Email *
            </Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="user@example.com"
              placeholderTextColor={TEXT_MUTED}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              className="px-4 py-3 rounded-xl border"
              style={{
                backgroundColor: CARD_BACKGROUND_LIGHT,
                borderColor: BORDER_SOFT,
                fontFamily: "SourceSans3_400Regular",
                color: TEXT_PRIMARY_STRONG,
              }}
            />
          </View>

          {/* Duration Selection */}
          <View className="mb-6">
            <Text
              className="mb-3"
              style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_PRIMARY_STRONG }}
            >
              Subscription Duration *
            </Text>

            {SUBSCRIPTION_DURATIONS.map((duration) => (
              <Pressable
                key={duration.id}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSelectedDuration(duration.id);
                }}
                className="mb-2 p-4 rounded-xl border active:opacity-70"
                style={{
                  backgroundColor: selectedDuration === duration.id ? DEEP_FOREST : CARD_BACKGROUND_LIGHT,
                  borderColor: selectedDuration === duration.id ? DEEP_FOREST : BORDER_SOFT,
                }}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center">
                    <Ionicons
                      name={selectedDuration === duration.id ? "radio-button-on" : "radio-button-off"}
                      size={24}
                      color={selectedDuration === duration.id ? PARCHMENT : TEXT_SECONDARY}
                      style={{ marginRight: 12 }}
                    />
                    <Text
                      style={{
                        fontFamily: "SourceSans3_600SemiBold",
                        fontSize: 16,
                        color: selectedDuration === duration.id ? PARCHMENT : TEXT_PRIMARY_STRONG,
                      }}
                    >
                      {duration.label}
                    </Text>
                  </View>
                  {duration.months === null && (
                    <View
                      className="px-2 py-1 rounded"
                      style={{ backgroundColor: "#FFD700" }}
                    >
                      <Text
                        className="text-xs"
                        style={{ fontFamily: "SourceSans3_600SemiBold", color: "#000" }}
                      >
                        UNLIMITED
                      </Text>
                    </View>
                  )}
                </View>
              </Pressable>
            ))}
          </View>

          {/* Award Button */}
          <Pressable
            onPress={handleAwardSubscription}
            disabled={loading || !email.trim() || !selectedDuration}
            className="p-4 rounded-xl items-center active:opacity-70"
            style={{
              backgroundColor: (!email.trim() || !selectedDuration) ? "#CCCCCC" : DEEP_FOREST,
            }}
          >
            {loading ? (
              <ActivityIndicator color={PARCHMENT} />
            ) : (
              <Text
                style={{
                  fontFamily: "SourceSans3_600SemiBold",
                  fontSize: 16,
                  color: PARCHMENT,
                }}
              >
                Award Subscription
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>

      <ConfirmationModal
        visible={!!pendingGrant}
        title="Confirm subscription grant"
        message={pendingGrant ? `Grant a ${pendingGrant.duration.label} premium subscription to ${pendingGrant.email}?` : undefined}
        primary={{ label: "Grant Subscription", iconName: "gift", onPress: confirmAwardSubscription }}
        secondary={{ label: "Cancel", onPress: () => setPendingGrant(null) }}
        onClose={() => setPendingGrant(null)}
      />
    </View>
  );
}
