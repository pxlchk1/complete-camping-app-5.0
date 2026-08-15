import React, { useCallback } from "react";
import { View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import { RootStackParamList } from "./types";
import CustomBottomTabBar from "../components/CustomBottomTabBar";
import EmailVerificationGate from "../components/EmailVerificationGate";
import { useAuthStore } from "../state/authStore";
import { PAYWALL_ENABLED } from "../config/subscriptions";
import { useNotificationListeners } from "../hooks/useNotifications";

// Screens
import HomeScreen from "../screens/HomeScreen";
import LearnTopTabsNavigator from "./LearnTopTabsNavigator";
import MyTripsScreen from "../screens/MyTripsScreen";
import CommunityTopTabsNavigator from "./CommunityTopTabsNavigator";
import PlanTopTabsNavigator from "./PlanTopTabsNavigator";
import { PlanErrorBoundary } from "../components/PlanErrorBoundary";
import { CommunityErrorBoundary } from "../components/CommunityErrorBoundary";
import FirstAidScreen from "../screens/FirstAidScreen";
import CreateTripScreen from "../screens/CreateTripScreen";
import TripDetailScreen from "../screens/TripDetailScreen";
import ParksBrowseScreen from "../screens/ParksBrowseScreen";
import MyCampsiteScreen from "../screens/MyCampsiteScreen";
import AccountScreen from "../screens/AccountScreen";
import MyCampgroundScreen from "../screens/MyCampgroundScreen";
import AddCamperScreen from "../screens/AddCamperScreen";
import EditCamperScreen from "../screens/EditCamperScreen";
import AddPeopleToTripScreen from "../screens/AddPeopleToTripScreen";
import AuthLanding from "../screens/AuthLanding";
import ForgotPasswordScreen from "../screens/ForgotPasswordScreen";
import PackingListCreateScreen from "../screens/PackingListCreateScreen";
import PackingListEditorScreen from "../screens/PackingListEditorScreen";
import MealPlanningScreen from "../screens/MealPlanningScreen";
import ShoppingListScreen from "../screens/ShoppingListScreen";
import PaywallScreen from "../screens/PaywallScreen";
import ModuleDetailScreen from "../screens/ModuleDetailScreen";
import NotificationsScreen from "../screens/NotificationsScreen";
import SettingsScreen from "../screens/SettingsScreen";

// Utility screens
import SeedDataScreen from "../screens/SeedDataScreen";

// Community screens
import TipsListScreen from "../screens/community/TipsListScreen";
import TipDetailScreen from "../screens/community/TipDetailScreen";
import CreateTipScreen from "../screens/community/CreateTipScreen";
import GearReviewsListScreen from "../screens/community/GearReviewsListScreen";
import GearReviewDetailScreen from "../screens/community/GearReviewDetailScreen";
import CreateGearReviewScreen from "../screens/community/CreateGearReviewScreen";
import EditGearReviewScreen from "../screens/community/EditGearReviewScreen";
import QuestionsListScreen from "../screens/community/QuestionsListScreen";
import QuestionDetailScreen from "../screens/community/QuestionDetailScreen";
import CreateQuestionScreen from "../screens/community/CreateQuestionScreen";
import PhotosListScreen from "../screens/community/PhotosListScreen";
import PhotoDetailScreen from "../screens/community/PhotoDetailScreen";
import PhotoComposerScreen from "../screens/community/PhotoComposerScreen";
import FeedbackListScreen from "../screens/community/FeedbackListScreen";
import FeedbackDetailScreen from "../screens/community/FeedbackDetailScreen";
import CreateFeedbackScreen from "../screens/community/CreateFeedbackScreen";

// Gear Closet screens
import MyGearClosetScreen from "../screens/MyGearClosetScreen";
import AddGearScreen from "../screens/AddGearScreen";
import EditGearScreen from "../screens/EditGearScreen";
import GearDetailScreen from "../screens/GearDetailScreen";
import EditProfileScreen from "../screens/EditProfileScreen";

// Admin screens
import AdminDashboardScreen from "../screens/AdminDashboardScreen";
import AdminReportsScreen from "../screens/AdminReportsScreen";
import AdminUsersScreen from "../screens/AdminUsersScreen";
import AdminSubscriptionsScreen from "../screens/AdminSubscriptionsScreen";
import AdminPhotosScreen from "../screens/AdminPhotosScreen";
import AdminContentScreen from "../screens/AdminContentScreen";
import AdminGatingReportScreen from "../screens/admin/AdminGatingReportScreen";
import AdminCommunicationsScreen from "../screens/AdminCommunicationsScreen";
import AdminGate from "../components/AdminGate";

// None of the admin screens checked whether the signed-in user was
// actually an admin — wrapping them here (once, in the navigator) rather
// than editing all 8 screens individually.
function withAdminGate<P extends object>(Component: React.ComponentType<P>) {
  return function AdminGated(props: P) {
    return (
      <AdminGate>
        <Component {...props} />
      </AdminGate>
    );
  };
}

const GatedAdminDashboardScreen = withAdminGate(AdminDashboardScreen);
const GatedAdminReportsScreen = withAdminGate(AdminReportsScreen);
const GatedAdminUsersScreen = withAdminGate(AdminUsersScreen);
const GatedAdminSubscriptionsScreen = withAdminGate(AdminSubscriptionsScreen);
const GatedAdminPhotosScreen = withAdminGate(AdminPhotosScreen);
const GatedAdminContentScreen = withAdminGate(AdminContentScreen);
const GatedAdminGatingReportScreen = withAdminGate(AdminGatingReportScreen);
const GatedAdminCommunicationsScreen = withAdminGate(AdminCommunicationsScreen);

// Invite screens
import AcceptInviteScreen from "../screens/AcceptInviteScreen";
import AcceptTripInviteScreen from "../screens/AcceptTripInviteScreen";

// Merit Badges screens
import MeritBadgesScreen from "../screens/MeritBadgesScreen";
import BadgeDetailScreen from "../screens/BadgeDetailScreen";
import SelectWitnessScreen from "../screens/SelectWitnessScreen";
import WitnessRequestsScreen from "../screens/WitnessRequestsScreen";
import MyBadgesScreen from "../screens/MyBadgesScreen";
import MeritBadgeAssetCheck from "../screens/MeritBadgeAssetCheck";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();
const PlanStack = createNativeStackNavigator();

function PlanStackNavigator(props: any) {
  return (
    <PlanErrorBoundary navigation={props.navigation}>
      <PlanStack.Navigator
        screenOptions={{
          headerShown: false,
        }}
      >
        <PlanStack.Screen name="MyTrips" component={PlanTopTabsNavigator} />
        <PlanStack.Screen name="ParksBrowse" component={ParksBrowseScreen} />
      </PlanStack.Navigator>
    </PlanErrorBoundary>
  );
}

function CommunityStackNavigator(props: any) {
  // Extract screen param to pass as initialRouteName to the top tabs
  const initialTab = props?.route?.params?.screen;
  return (
    <CommunityErrorBoundary navigation={props.navigation}>
      <CommunityTopTabsNavigator initialRouteName={initialTab} />
    </CommunityErrorBoundary>
  );
}

function HomeTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <CustomBottomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Learn" component={LearnTopTabsNavigator} />
      <Tab.Screen name="Plan" component={PlanStackNavigator} />
      <Tab.Screen name="Connect" component={CommunityStackNavigator} />
      <Tab.Screen name="FirstAid" component={FirstAidScreen} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const user = useAuthStore((s) => s.user);
  const navigation = useNavigation();

  // Stable navigate wrapper for notification tap routing
  const navigateFn = useCallback(
    (screen: string, params?: Record<string, any>) => {
      (navigation as any).navigate(screen, params);
    },
    [navigation]
  );

  // Register notification listeners (tap handler, badge clear, push token)
  useNotificationListeners(navigateFn);
  
  return (
    <View style={{ flex: 1 }}>
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
      initialRouteName={user ? "HomeTabs" : "Auth"}
    >
      <Stack.Screen name="Auth" component={AuthLanding} options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="HomeTabs" component={HomeTabs} />
      <Stack.Screen name="CreateTrip" component={CreateTripScreen} />
      <Stack.Screen name="TripDetail" component={TripDetailScreen} />
      <Stack.Screen name="Account" component={AccountScreen} />
      <Stack.Screen name="MyCampsite" component={MyCampsiteScreen} />
      <Stack.Screen name="MyCampground" component={MyCampgroundScreen} options={{ title: "My Campground" }} />
      <Stack.Screen name="AddCamper" component={AddCamperScreen} />
      <Stack.Screen name="EditCamper" component={EditCamperScreen} />
      <Stack.Screen name="AddPeopleToTrip" component={AddPeopleToTripScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      {/* Dev-only data seeding tool — its "Verify Badge Assets" button is
          already gated behind __DEV__, but the screen itself wasn't,
          so gate the route the same way as MeritBadgeAssetCheck below. */}
      {__DEV__ && <Stack.Screen name="SeedData" component={SeedDataScreen} />}

      {/* Accept Invite (from deep link: /join?token=...) */}
      <Stack.Screen
        name="AcceptInvite"
        component={AcceptInviteScreen}
        options={{ headerShown: false, presentation: 'modal' }}
      />

      {/* Accept Trip Invite (from deep link: /trip-invite?token=...) */}
      <Stack.Screen
        name="AcceptTripInvite"
        component={AcceptTripInviteScreen}
        options={{ headerShown: false, presentation: 'modal' }}
      />

      {/* Learning */}
      <Stack.Screen name="ModuleDetail" component={ModuleDetailScreen} />

      {/* Merit Badges */}
      <Stack.Screen name="MeritBadges" component={MeritBadgesScreen} />
      <Stack.Screen name="BadgeDetail" component={BadgeDetailScreen} />
      <Stack.Screen name="SelectWitness" component={SelectWitnessScreen} />
      <Stack.Screen name="WitnessRequests" component={WitnessRequestsScreen} />
      <Stack.Screen name="MyBadges" component={MyBadgesScreen} />
      {/* Dev-only badge asset verification */}
      {__DEV__ && <Stack.Screen name="MeritBadgeAssetCheck" component={MeritBadgeAssetCheck} />}


      {/* Subscription */}
      {PAYWALL_ENABLED && (
        <Stack.Screen
          name="Paywall"
          component={PaywallScreen}
          options={{
            presentation: 'modal',
            headerShown: false,
          }}
        />
      )}

      {/* Trip Planning screens */}
      <Stack.Screen name="MealPlanning" component={MealPlanningScreen} />
      <Stack.Screen name="ShoppingList" component={ShoppingListScreen} />
      <Stack.Screen name="ParksBrowse" component={ParksBrowseScreen} />

      {/* New Packing List screens (local-first) */}
      <Stack.Screen name="PackingListCreate" component={PackingListCreateScreen} />
      <Stack.Screen name="PackingListEditor" component={PackingListEditorScreen} />

      {/* Tips */}
      <Stack.Screen name="TipsListScreen" component={TipsListScreen} />
      <Stack.Screen name="TipDetail" component={TipDetailScreen} />
      <Stack.Screen name="CreateTip" component={CreateTipScreen} />

      {/* Gear Reviews */}
      <Stack.Screen name="GearReviewsListScreen" component={GearReviewsListScreen} />
      <Stack.Screen name="GearReviewDetail" component={GearReviewDetailScreen} />
      <Stack.Screen name="CreateGearReview" component={CreateGearReviewScreen} />
      <Stack.Screen name="EditGearReview" component={EditGearReviewScreen} />

      {/* Questions/Ask */}
      <Stack.Screen name="QuestionsListScreen" component={QuestionsListScreen} />
      <Stack.Screen name="QuestionDetail" component={QuestionDetailScreen} />
      <Stack.Screen name="CreateQuestion" component={CreateQuestionScreen} />

      {/* Photos */}
      <Stack.Screen name="PhotosListScreen" component={PhotosListScreen} />
      <Stack.Screen name="PhotoDetail" component={PhotoDetailScreen} />
      <Stack.Screen name="PhotoComposer" component={PhotoComposerScreen} />

      {/* Feedback */}
      <Stack.Screen name="FeedbackListScreen" component={FeedbackListScreen} />
      <Stack.Screen name="FeedbackDetail" component={FeedbackDetailScreen} />
      <Stack.Screen name="CreateFeedback" component={CreateFeedbackScreen} />

      {/* Gear Closet */}
      <Stack.Screen name="MyGearCloset" component={MyGearClosetScreen} />
      <Stack.Screen name="AddGear" component={AddGearScreen} />
      <Stack.Screen name="EditGear" component={EditGearScreen} />
      <Stack.Screen name="GearDetail" component={GearDetailScreen} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} />

      {/* Admin screens — gated behind AdminGate (see withAdminGate above) */}
      <Stack.Screen name="AdminDashboard" component={GatedAdminDashboardScreen} />
      <Stack.Screen name="AdminReports" component={GatedAdminReportsScreen} />
      <Stack.Screen name="AdminUsers" component={GatedAdminUsersScreen} />
      <Stack.Screen name="AdminSubscriptions" component={GatedAdminSubscriptionsScreen} />
      <Stack.Screen name="AdminPhotos" component={GatedAdminPhotosScreen} />
      <Stack.Screen name="AdminContent" component={GatedAdminContentScreen} />
      <Stack.Screen name="AdminGatingReport" component={GatedAdminGatingReportScreen} />
      <Stack.Screen name="AdminCommunications" component={GatedAdminCommunicationsScreen} />
    </Stack.Navigator>
    {user && <EmailVerificationGate />}
    </View>
  );
}
