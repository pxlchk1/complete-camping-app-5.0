/**
 * Accept Invitation Screen
 * Handles campground invitation acceptance via deep link (old /invite/:token format)
 */

import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../config/firebase";
import {
  getInvitationData,
  acceptInvitation,
  InvitationData,
} from "../services/deepLinkService";
import { RootStackParamList } from "../navigation/types";
import {
  DEEP_FOREST,
  EARTH_GREEN,
  PARCHMENT,
  CARD_BACKGROUND_LIGHT,
  TEXT_PRIMARY_STRONG,
  TEXT_SECONDARY,
  TEXT_MUTED,
  RUST,
} from "../constants/colors";

type AcceptInvitationRouteProp = RouteProp<RootStackParamList, "AcceptInvitation">;

export default function AcceptInvitationScreen() {
  const navigation = useNavigation();
  const route = useRoute<AcceptInvitationRouteProp>();
  const { invitationToken } = route.params;

  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Shown inline instead of a native Alert — e.g. "wrong account signed in".
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [accepted, setAcceptedInfo] = useState<{ inviterName: string } | null>(null);

  // Guards against redeeming twice if Firebase fires more than one auth event.
  const hasAttemptedRef = useRef(false);

  useEffect(() => {
    loadInvitation();
  }, []);

  // Mirrors the fix in AcceptInviteScreen: rather than sending a guest to
  // Auth and hoping they come back on their own, listen for the moment
  // Firebase reports a signed-in user and resume acceptance automatically.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user && invitation && !accepted && !hasAttemptedRef.current) {
        hasAttemptedRef.current = true;
        handleAccept();
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invitation, accepted]);

  const loadInvitation = async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await getInvitationData(invitationToken);

      if (!data) {
        setError("This invitation link is invalid or has been removed.");
        return;
      }

      if (data.status === "expired") {
        setError("This invitation has expired. Please ask for a new invitation.");
        return;
      }

      if (data.status === "accepted") {
        setError("This invitation has already been accepted.");
        return;
      }

      setInvitation(data);
    } catch (err: any) {
      console.error("Error loading invitation:", err);
      setError("Failed to load invitation. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async () => {
    const user = auth.currentUser;

    if (!user) {
      setActionMessage(null);
      navigation.navigate("Auth" as any, { returnTo: true });
      return;
    }

    if (!invitation) return;

    // Check if email matches
    if (user.email?.toLowerCase() !== invitation.recipientEmail.toLowerCase()) {
      setActionMessage(
        `This invitation was sent to ${invitation.recipientEmail}. Please sign out and sign in with that email address.`
      );
      return;
    }

    try {
      setAccepting(true);
      setActionMessage(null);
      await acceptInvitation(invitationToken);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAcceptedInfo({ inviterName: invitation.inviterName });
    } catch (err: any) {
      console.error("Error accepting invitation:", err);
      setActionMessage(err.message || "Failed to accept invitation");
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: PARCHMENT }}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={EARTH_GREEN} />
          <Text
            className="mt-4"
            style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}
          >
            Loading invitation...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !invitation) {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: PARCHMENT }}>
        <View className="flex-1 items-center justify-center px-6">
          <Ionicons name="alert-circle" size={64} color={TEXT_MUTED} />
          <Text
            className="text-xl mt-4 mb-2 text-center"
            style={{ fontFamily: "Raleway_700Bold", color: TEXT_PRIMARY_STRONG }}
          >
            Invitation Not Available
          </Text>
          <Text
            className="text-center mb-6"
            style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}
          >
            {error}
          </Text>
          <Pressable
            onPress={() => navigation.goBack()}
            className="px-6 py-3 rounded-xl active:opacity-70"
            style={{ backgroundColor: DEEP_FOREST }}
          >
            <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: PARCHMENT }}>
              Go Back
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (accepted) {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: PARCHMENT }}>
        <View className="flex-1 items-center justify-center px-8">
          <View
            className="w-24 h-24 rounded-full items-center justify-center mb-6"
            style={{ backgroundColor: EARTH_GREEN + "20" }}
          >
            <Ionicons name="checkmark-circle" size={64} color={EARTH_GREEN} />
          </View>
          <Text
            className="text-2xl text-center mb-3"
            style={{ fontFamily: "SourceSans3_700Bold", color: TEXT_PRIMARY_STRONG }}
          >
            {"Welcome to the Campground! 🏕️"}
          </Text>
          <Text
            className="text-center mb-8"
            style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY, fontSize: 16 }}
          >
            {`You've successfully joined ${accepted.inviterName}'s campground. You'll now be included in their camping trips.`}
          </Text>
          <Pressable
            onPress={() => navigation.navigate("MyCampground" as any)}
            className="w-full py-4 rounded-xl active:opacity-90"
            style={{ backgroundColor: DEEP_FOREST }}
          >
            <Text
              className="text-center"
              style={{ fontFamily: "SourceSans3_600SemiBold", color: PARCHMENT, fontSize: 16 }}
            >
              View My Campground
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: PARCHMENT }}>
      <View className="flex-1 px-6 pt-8">
        {/* Header */}
        <View className="items-center mb-8">
          <View
            className="w-24 h-24 rounded-full items-center justify-center mb-4"
            style={{ backgroundColor: CARD_BACKGROUND_LIGHT }}
          >
            <Ionicons name="mail-open" size={48} color={EARTH_GREEN} />
          </View>
          <Text
            className="text-3xl text-center"
            style={{ fontFamily: "Raleway_700Bold", color: TEXT_PRIMARY_STRONG }}
          >
            You're Invited!
          </Text>
        </View>

        {/* Invitation Details */}
        <View
          className="p-6 rounded-xl mb-6"
          style={{ backgroundColor: CARD_BACKGROUND_LIGHT }}
        >
          <Text
            className="text-lg mb-4 text-center"
            style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_PRIMARY_STRONG }}
          >
            {invitation.inviterName} wants you to join their campground
          </Text>

          <View className="space-y-3">
            <View className="flex-row items-center">
              <Ionicons name="person" size={20} color={EARTH_GREEN} />
              <Text
                className="ml-3"
                style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}
              >
                Invited as: {invitation.recipientName}
              </Text>
            </View>
            <View className="flex-row items-center">
              <Ionicons name="mail" size={20} color={EARTH_GREEN} />
              <Text
                className="ml-3"
                style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}
              >
                {invitation.recipientEmail}
              </Text>
            </View>
          </View>
        </View>

        {/* Benefits */}
        <View className="mb-6">
          <Text
            className="text-base mb-3"
            style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_PRIMARY_STRONG }}
          >
            By joining their campground, you'll:
          </Text>
          <View className="space-y-2">
            <View className="flex-row items-start">
              <Ionicons name="checkmark-circle" size={20} color={EARTH_GREEN} />
              <Text
                className="ml-2 flex-1"
                style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}
              >
                Be included in their camping trip plans
              </Text>
            </View>
            <View className="flex-row items-start">
              <Ionicons name="checkmark-circle" size={20} color={EARTH_GREEN} />
              <Text
                className="ml-2 flex-1"
                style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}
              >
                Share packing lists and meal plans
              </Text>
            </View>
            <View className="flex-row items-start">
              <Ionicons name="checkmark-circle" size={20} color={EARTH_GREEN} />
              <Text
                className="ml-2 flex-1"
                style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}
              >
                Coordinate gear and supplies together
              </Text>
            </View>
          </View>
        </View>

        {actionMessage ? (
          <View
            className="flex-row items-start p-3 rounded-xl mb-4"
            style={{ backgroundColor: RUST + "15" }}
          >
            <Ionicons name="alert-circle" size={18} color={RUST} style={{ marginTop: 1 }} />
            <Text
              className="ml-2 flex-1"
              style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_PRIMARY_STRONG, fontSize: 13, lineHeight: 18 }}
            >
              {actionMessage}
            </Text>
          </View>
        ) : null}

        {/* Accept Button */}
        <Pressable
          onPress={handleAccept}
          disabled={accepting}
          className="py-3 rounded-lg items-center active:opacity-70 mb-4"
          style={{ backgroundColor: EARTH_GREEN }}
        >
          {accepting ? (
            <ActivityIndicator color={PARCHMENT} />
          ) : (
            <Text style={{ fontFamily: "SourceSans3_600SemiBold", fontSize: 15, color: PARCHMENT }}>
              {auth.currentUser ? "Accept Invitation" : "Sign In to Accept"}
            </Text>
          )}
        </Pressable>

        {/* Decline Button */}
        <Pressable
          onPress={() => navigation.goBack()}
          className="py-3 items-center active:opacity-70"
        >
          <Text style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}>
            Not Now
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
