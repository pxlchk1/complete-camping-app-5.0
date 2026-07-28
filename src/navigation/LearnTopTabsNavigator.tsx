/**
 * Learn Top Tabs Navigator
 * Material top tabs for Learn and Merit Badges
 */

import React, { useState } from "react";
import { View, ImageBackground, Text, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs";
import { Ionicons } from "@expo/vector-icons";

import { useScreenOnboarding } from "../hooks/useScreenOnboarding";

import AccountButtonHeader from "../components/AccountButtonHeader";
import { OnboardingModal } from "../components/OnboardingModal";
import MeritBadgesInfoModal from "../components/MeritBadgesInfoModal";

import LearnScreen from "../screens/LearnScreen";
import MeritBadgesScreen from "../screens/MeritBadgesScreen";

import { DEEP_FOREST, PARCHMENT, BORDER_SOFT, TEXT_ON_DARK } from "../constants/colors";
import { HERO_IMAGES } from "../constants/images";

const Tab = createMaterialTopTabNavigator();

// Map tab routes to titles and descriptions
const getHeroContent = (routeName: string) => {
  switch (routeName) {
    case "Merit Badges":
      return { title: "Learn", description: "Earn badges by completing camping challenges" };
    case "Learn":
    default:
      return { title: "Learn", description: "Master camping skills and earn badges" };
  }
};

function HeroHeader({ activeTab, onInfoPress }: { activeTab: string; onInfoPress?: () => void }) {
  const insets = useSafeAreaInsets();
  const { title, description } = getHeroContent(activeTab);

  return (
    <View style={{ height: 200 + insets.top }}>
      <ImageBackground
        source={HERO_IMAGES.LEARNING}
        style={{ flex: 1 }}
        resizeMode="cover"
        accessibilityLabel="Learning and education scene"
      >
        <View className="flex-1" style={{ paddingTop: insets.top }}>
          {/* Account Button - Top Right */}
          <AccountButtonHeader color={TEXT_ON_DARK} />

          <View className="flex-1 justify-end px-6 pb-4">
            <LinearGradient
              colors={["transparent", "rgba(0,0,0,0.5)"]}
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: 100,
              }}
            />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text
                className="text-parchment text-3xl"
                style={{
                  fontFamily: "Raleway_700Bold",
                  textShadowColor: "rgba(0, 0, 0, 0.5)",
                  textShadowOffset: { width: 0, height: 1 },
                  textShadowRadius: 4,
                  zIndex: 1,
                }}
              >
                {title}
              </Text>
              {onInfoPress && (
                <Pressable onPress={onInfoPress} style={{ padding: 4 }} accessibilityLabel="Info">
                  <Ionicons name="information-circle-outline" size={24} color={PARCHMENT} />
                </Pressable>
              )}
            </View>
            <Text
              className="text-parchment mt-2"
              style={{
                fontFamily: "SourceSans3_400Regular",
                textShadowColor: "rgba(0, 0, 0, 0.5)",
                textShadowOffset: { width: 0, height: 1 },
                textShadowRadius: 3,
                zIndex: 1,
              }}
            >
              {description}
            </Text>
          </View>
        </View>
      </ImageBackground>
    </View>
  );
}

export default function LearnTopTabsNavigator() {
  // Active route name, kept in sync from the tab navigator's own state
  // change events (not computed during render) so hero content and the
  // info button match whichever tab is actually focused.
  const [activeRoute, setActiveRoute] = useState<string>("Learn");

  // Onboarding for Learn tab
  const learnOnboarding = useScreenOnboarding("Learn");

  // Merit Badges info modal state
  const [showBadgesInfoModal, setShowBadgesInfoModal] = useState(false);

  const onInfoPress =
    activeRoute === "Merit Badges" ? () => setShowBadgesInfoModal(true) : learnOnboarding.openModal;

  return (
    <View className="flex-1 bg-parchment">
      {/* Hero Header */}
      <HeroHeader activeTab={activeRoute} onInfoPress={onInfoPress} />

      {/* Material Top Tabs */}
      <Tab.Navigator
        screenOptions={{
          tabBarStyle: {
            backgroundColor: PARCHMENT,
            borderBottomWidth: 1,
            borderBottomColor: BORDER_SOFT,
            elevation: 0,
            shadowOpacity: 0,
          },
          tabBarActiveTintColor: DEEP_FOREST,
          tabBarInactiveTintColor: "#696969",
          tabBarIndicatorStyle: {
            backgroundColor: "#f59e0b",
            height: 3,
          },
          tabBarLabelStyle: {
            fontFamily: "SourceSans3_600SemiBold",
            fontSize: 13,
            textTransform: "none",
          },
          tabBarScrollEnabled: false,
        }}
        screenListeners={{
          state: (e: any) => {
            const state = e.data.state;
            const routeName = state.routes[state.index]?.name;
            if (routeName) setActiveRoute(routeName);
          },
        }}
      >
        <Tab.Screen name="Learn" component={LearnScreen} />
        <Tab.Screen name="Merit Badges" component={MeritBadgesScreen} />
      </Tab.Navigator>

      {/* Onboarding Modal for Learn tab */}
      {activeRoute === "Learn" && (
        <OnboardingModal
          visible={learnOnboarding.showModal}
          tooltip={learnOnboarding.currentTooltip}
          onDismiss={learnOnboarding.dismissModal}
        />
      )}

      {/* Merit Badges Info Modal */}
      <MeritBadgesInfoModal visible={showBadgesInfoModal} onDismiss={() => setShowBadgesInfoModal(false)} />
    </View>
  );
}
