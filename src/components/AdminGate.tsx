import React from "react";
import { View, Text, ActivityIndicator, Pressable } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { DEEP_FOREST, PARCHMENT, TEXT_PRIMARY_STRONG, TEXT_SECONDARY, RUST } from "../constants/colors";

/**
 * Wraps an admin screen so it actually requires an admin account to view.
 * Previously every admin route (AdminDashboard, AdminUsers,
 * AdminSubscriptions, AdminContent, AdminPhotos, AdminReports,
 * AdminGatingReport, AdminCommunications) had no check at all above the
 * Firestore/Cloud Function layer — any signed-in user who found or guessed
 * the route name could open them.
 */
export default function AdminGate({ children }: { children: React.ReactNode }) {
  const status = useIsAdmin();
  const navigation = useNavigation();

  if (status === "checking") {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: PARCHMENT }}>
        <ActivityIndicator size="large" color={DEEP_FOREST} />
      </View>
    );
  }

  if (status === "not-admin") {
    return (
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: PARCHMENT }}>
        <Ionicons name="lock-closed" size={56} color={RUST} />
        <Text
          className="text-xl mt-4 mb-2 text-center"
          style={{ fontFamily: "Raleway_700Bold", color: TEXT_PRIMARY_STRONG }}
        >
          Admins Only
        </Text>
        <Text
          className="text-center mb-6"
          style={{ fontFamily: "SourceSans3_400Regular", color: TEXT_SECONDARY }}
        >
          You don&apos;t have access to this page.
        </Text>
        <Pressable
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate("HomeTabs" as never))}
          className="px-6 py-3 rounded-xl active:opacity-80"
          style={{ backgroundColor: DEEP_FOREST }}
        >
          <Text style={{ fontFamily: "SourceSans3_600SemiBold", color: PARCHMENT }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return <>{children}</>;
}
