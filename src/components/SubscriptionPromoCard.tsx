/**
 * SubscriptionPromoCard
 *
 * Compact, dismissible, non-blocking promotional card used to surface a
 * subscription offer alongside an already-free feature (weather, trip
 * dashboard) without gating anything. Tapping the card opens the paywall
 * for the given placement; tapping the close button dismisses it for the
 * rest of this app session only (see sessionService.dismissForSession).
 *
 * Never rendered for Pro users - callers should check that before mounting
 * this, but it's also safe to always render since Pro users have no reason
 * to see it (kept as a call-site decision, not baked in here, so each
 * screen stays in control of its own visibility logic).
 */

import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import * as Haptics from "expo-haptics";

import { PaywallPlacement } from "../config/paywallPlacements";
import { trackPaywallDismissed } from "../services/analyticsService";
import { dismissForSession } from "../services/sessionService";
import { DEEP_FOREST, PARCHMENT, CARD_BACKGROUND_LIGHT, BORDER_SOFT, TEXT_PRIMARY_STRONG, TEXT_SECONDARY } from "../constants/colors";

interface SubscriptionPromoCardProps {
  placement: PaywallPlacement;
  title: string;
  body: string;
  onDismiss: () => void;
}

export default function SubscriptionPromoCard({ placement, title, body, onDismiss }: SubscriptionPromoCardProps) {
  const navigation = useNavigation<any>();

  const handleOpen = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("Paywall", { triggerKey: placement });
  };

  const handleDismiss = () => {
    Haptics.selectionAsync();
    dismissForSession(placement);
    trackPaywallDismissed({ placement });
    onDismiss();
  };

  return (
    <View
      className="mb-4 rounded-2xl overflow-hidden"
      style={{ backgroundColor: CARD_BACKGROUND_LIGHT, borderWidth: 1, borderColor: BORDER_SOFT }}
      accessibilityRole="none"
    >
      <Pressable
        onPress={handleOpen}
        className="p-4 flex-row items-start active:opacity-90"
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${body}`}
        accessibilityHint="Opens subscription options"
      >
        <View
          className="w-9 h-9 rounded-full items-center justify-center mr-3"
          style={{ backgroundColor: DEEP_FOREST }}
        >
          <Ionicons name="star" size={18} color={PARCHMENT} />
        </View>
        <View className="flex-1 pr-2">
          <Text
            style={{ fontFamily: "SourceSans3_700Bold", fontSize: 15, color: TEXT_PRIMARY_STRONG, marginBottom: 2 }}
          >
            {title}
          </Text>
          <Text
            style={{ fontFamily: "SourceSans3_400Regular", fontSize: 13, color: TEXT_SECONDARY, lineHeight: 18 }}
          >
            {body}
          </Text>
        </View>
        <Pressable
          onPress={handleDismiss}
          hitSlop={10}
          className="p-1 -mt-1 -mr-1 active:opacity-70"
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        >
          <Ionicons name="close" size={18} color={TEXT_SECONDARY} />
        </Pressable>
      </Pressable>
    </View>
  );
}
