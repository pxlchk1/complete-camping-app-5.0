/**
 * HiddenReviewBanner
 *
 * Three downvotes auto-hides a post from everyone but its author (see
 * moderationService.checkAndApplyAutoHide / shouldShowInFeed) - but until
 * this component existed, the author had no way to know it happened. Drop
 * this at the top of a detail screen's content, gated on
 * `item.isHidden && item.authorId === currentUserId`.
 */

import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function HiddenReviewBanner() {
  return (
    <View
      style={{
        backgroundColor: "#fef3c7",
        borderWidth: 1,
        borderColor: "#fbbf24",
        borderRadius: 12,
        padding: 12,
        marginBottom: 16,
        flexDirection: "row",
        alignItems: "flex-start",
      }}
    >
      <Ionicons name="eye-off-outline" size={18} color="#78350f" style={{ marginRight: 8, marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: "SourceSans3_600SemiBold", fontSize: 13, color: "#78350f" }}>
          Hidden pending review
        </Text>
        <Text style={{ fontFamily: "SourceSans3_400Regular", fontSize: 12, color: "#78350f", marginTop: 2, lineHeight: 16 }}>
          This post received enough downvotes to be hidden from the community while a moderator takes a look. Only you can see it right now.
        </Text>
      </View>
    </View>
  );
}
