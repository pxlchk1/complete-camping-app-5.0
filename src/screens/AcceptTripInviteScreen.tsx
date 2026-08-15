/**
 * Accept Trip Invite Screen
 * Allows users to accept a trip share invitation via deep link token.
 * Mirrors AcceptInviteScreen.tsx (campground invites) - same flow, same
 * guest/auth handling, scoped to a single trip with a view/edit permission.
 */

import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { useRoute, useNavigation, RouteProp } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../config/firebase";
import { redeemTripShareInvite } from "../services/tripShareInviteService";
import { useUserStatus } from "../utils/authHelper";
import AccountRequiredModal from "../components/AccountRequiredModal";
import { RootStackParamList, RootStackNavigationProp } from "../navigation/types";
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

type AcceptTripInviteRouteProp = RouteProp<RootStackParamList, "AcceptTripInvite">;

type InviteState = "loading" | "ready" | "accepting" | "success" | "error";

export default function AcceptTripInviteScreen() {
  const route = useRoute<AcceptTripInviteRouteProp>();
  const navigation = useNavigation<RootStackNavigationProp>();
  const insets = useSafeAreaInsets();
  const { isGuest } = useUserStatus();

  const { token } = route.params;

  const [state, setState] = useState<InviteState>("loading");
  const [tripId, setTripId] = useState<string | null>(null);
  const [tripName, setTripName] = useState<string | null>(null);
  const [permission, setPermission] = useState<"view" | "edit" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showAccountModal, setShowAccountModal] = useState(false);

  const hasAttemptedRef = useRef(false);
  const cameFromAuthPromptRef = useRef(false);

  useEffect(() => {
    if (isGuest) {
      setShowAccountModal(true);
      setState("ready");
    } else {
      setState("ready");
    }
  }, [isGuest, token]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (
        user &&
        !hasAttemptedRef.current &&
        cameFromAuthPromptRef.current &&
        (state === "ready" || state === "loading")
      ) {
        hasAttemptedRef.current = true;
        setShowAccountModal(false);
        handleAcceptInvite();
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const handleAcceptInvite = async () => {
    if (!token) {
      setErrorMessage("Invalid invite link");
      setState("error");
      return;
    }

    if (!auth.currentUser) {
      setShowAccountModal(true);
      return;
    }

    try {
      setState("accepting");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const result = await redeemTripShareInvite(token);

      if (result.success) {
        setTripId(result.tripId);
        setTripName(result.tripName);
        setPermission(result.permission);
        setState("success");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setErrorMessage("Failed to accept invite");
        setState("error");
      }
    } catch (error: any) {
      console.error("Error accepting trip invite:", error);
      setErrorMessage(error.message || "Failed to accept invite");
      setState("error");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleGoToTrip = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.reset({
      index: 0,
      routes: [{ name: "HomeTabs" }],
    });
    if (tripId) {
      setTimeout(() => {
        navigation.navigate("TripDetail", { tripId });
      }, 100);
    }
  };

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.reset({ index: 0, routes: [{ name: "HomeTabs" }] });
    }
  };

  const handleAccountModalClose = () => {
    setShowAccountModal(false);
  };

  const handleGoToAuth = () => {
    cameFromAuthPromptRef.current = true;
    setShowAccountModal(false);
    navigation.navigate("Auth", { returnTo: true });
  };

  if (state === "loading") {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: PARCHMENT, paddingTop: insets.top }}
      >
        <ActivityIndicator size="large" color={DEEP_FOREST} />
        <Text
          className="mt-4"
          style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}
        >
          Loading invitation...
        </Text>
      </View>
    );
  }

  if (state === "success") {
    return (
      <View
        className="flex-1 items-center justify-center px-8"
        style={{ backgroundColor: PARCHMENT, paddingTop: insets.top }}
      >
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
          {"You're In! 🏕️"}
        </Text>

        <Text
          className="text-center mb-8"
          style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY, fontSize: 16 }}
        >
          {permission === "edit"
            ? `You can now view and help plan "${tripName}".`
            : `You can now view "${tripName}".`}
        </Text>

        <Pressable
          onPress={handleGoToTrip}
          className="w-full py-4 rounded-xl active:opacity-90"
          style={{ backgroundColor: DEEP_FOREST }}
        >
          <Text
            className="text-center"
            style={{ fontFamily: "SourceSans3_600SemiBold", color: PARCHMENT, fontSize: 16 }}
          >
            Go to trip
          </Text>
        </Pressable>
      </View>
    );
  }

  if (state === "error") {
    return (
      <View
        className="flex-1 items-center justify-center px-8"
        style={{ backgroundColor: PARCHMENT, paddingTop: insets.top }}
      >
        <View
          className="w-24 h-24 rounded-full items-center justify-center mb-6"
          style={{ backgroundColor: RUST + "20" }}
        >
          <Ionicons name="alert-circle" size={64} color={RUST} />
        </View>

        <Text
          className="text-2xl text-center mb-3"
          style={{ fontFamily: "SourceSans3_700Bold", color: TEXT_PRIMARY_STRONG }}
        >
          {"Couldn't Accept Invite"}
        </Text>

        <Text
          className="text-center mb-8"
          style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY, fontSize: 16 }}
        >
          {errorMessage || "This invite may have expired or already been used."}
        </Text>

        <Pressable
          onPress={handleClose}
          className="w-full py-4 rounded-xl active:opacity-90"
          style={{ backgroundColor: DEEP_FOREST }}
        >
          <Text
            className="text-center"
            style={{ fontFamily: "SourceSans3_600SemiBold", color: PARCHMENT, fontSize: 16 }}
          >
            Close
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      className="flex-1 px-8"
      style={{ backgroundColor: PARCHMENT, paddingTop: insets.top }}
    >
      <Pressable
        onPress={handleClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full items-center justify-center active:opacity-70"
        style={{ backgroundColor: CARD_BACKGROUND_LIGHT, marginTop: insets.top }}
      >
        <Ionicons name="close" size={24} color={TEXT_PRIMARY_STRONG} />
      </Pressable>

      <View className="flex-1 items-center justify-center">
        <View
          className="w-24 h-24 rounded-full items-center justify-center mb-6"
          style={{ backgroundColor: EARTH_GREEN + "20" }}
        >
          <Ionicons name="map" size={48} color={EARTH_GREEN} />
        </View>

        <Text
          className="text-2xl text-center mb-3"
          style={{ fontFamily: "SourceSans3_700Bold", color: TEXT_PRIMARY_STRONG }}
        >
          {"You're Invited! 🏕️"}
        </Text>

        <Text
          className="text-center mb-2"
          style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY, fontSize: 16 }}
        >
          Someone shared a trip with you on The Complete Camping App!
        </Text>

        <Text
          className="text-center mb-8"
          style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_MUTED, fontSize: 14 }}
        >
          Accept to see the trip plan and coordinate together.
        </Text>

        <Pressable
          onPress={handleAcceptInvite}
          disabled={state === "accepting"}
          className="w-full py-4 rounded-xl active:opacity-90"
          style={{ backgroundColor: DEEP_FOREST }}
        >
          {state === "accepting" ? (
            <ActivityIndicator size="small" color={PARCHMENT} />
          ) : (
            <Text
              className="text-center"
              style={{ fontFamily: "SourceSans3_600SemiBold", color: PARCHMENT, fontSize: 16 }}
            >
              View Trip
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={handleClose}
          className="mt-4 py-2 active:opacity-70"
        >
          <Text
            className="text-center"
            style={{ fontFamily: "SourceSans3_600SemiBold", color: TEXT_SECONDARY }}
          >
            Not Now
          </Text>
        </Pressable>
      </View>

      <AccountRequiredModal
        visible={showAccountModal}
        triggerKey="view_shared_trip"
        onCreateAccount={handleGoToAuth}
        onLogIn={handleGoToAuth}
        onMaybeLater={handleAccountModalClose}
      />
    </View>
  );
}
