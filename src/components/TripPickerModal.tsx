/**
 * Trip Picker Modal
 * Allows user to select a trip to add gear to their packing list
 */

import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { Trip, useTripsStore } from "../state/tripsStore";
import { GearItem } from "../types/gear";
import { usePackingStore } from "../state/packingStore";
import { getPackingSectionForGear } from "../utils/gearToPackingCategory";
import { useToast } from "./ToastManager";
import {
  DEEP_FOREST,
  EARTH_GREEN,
  PARCHMENT,
  BORDER_SOFT,
  TEXT_PRIMARY_STRONG,
  TEXT_SECONDARY,
  CARD_BACKGROUND_LIGHT,
} from "../constants/colors";

interface TripPickerModalProps {
  visible: boolean;
  onClose: () => void;
  gearItem: GearItem | null;
  onSuccess?: () => void;
}

export default function TripPickerModal({
  visible,
  onClose,
  gearItem,
  onSuccess,
}: TripPickerModalProps) {
  const { show } = useToast();
  const trips = useTripsStore((state) => state.trips);
  const packingLists = usePackingStore((state) => state.packingLists);
  const addGearItemToList = usePackingStore((state) => state.addGearItemToList);
  const [adding, setAdding] = useState(false);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

  // Filter to active/upcoming trips only
  const activeTrips = useMemo(() => {
    const now = new Date();
    return trips.filter((trip) => {
      const endDate = new Date(trip.endDate);
      return endDate >= now;
    }).sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
  }, [trips]);

  const handleSelectTrip = (tripId: string) => {
    if (!gearItem) return;

    setSelectedTripId(tripId);
    setAdding(true);
    Haptics.selectionAsync();

    // Gear goes into the same local packingStore that PackingListEditorScreen
    // reads from — previously this wrote to a Firestore collection with no
    // matching security rule, silently fell back to an AsyncStorage bucket
    // nothing else ever read, and the item never actually showed up anywhere.
    const targetList = packingLists.find((list) => list.tripId === tripId && !list.isTemplate);

    if (!targetList) {
      show("Create a packing list for this trip first, then you can add gear to it from here.");
      setAdding(false);
      setSelectedTripId(null);
      return;
    }

    const sectionTitle = getPackingSectionForGear(gearItem.category);
    const result = addGearItemToList(targetList.id, { id: gearItem.id, name: gearItem.name }, sectionTitle);

    if (result.alreadyExists) {
      show(`${gearItem.name} is already on this trip\u2019s list`);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSuccess?.();
      onClose();
    }

    setAdding(false);
    setSelectedTripId(null);
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const renderTrip = ({ item: trip }: { item: Trip }) => {
    const isSelected = selectedTripId === trip.id;
    const tripName = trip.name || trip.destination?.name || "Untitled Trip";
    const startDate = formatDate(trip.startDate);
    const endDate = formatDate(trip.endDate);

    return (
      <Pressable
        onPress={() => handleSelectTrip(trip.id)}
        disabled={adding}
        className="flex-row items-center px-4 py-4 border-b"
        style={{
          borderColor: BORDER_SOFT,
          backgroundColor: isSelected ? "rgba(26, 76, 57, 0.08)" : PARCHMENT,
          opacity: adding && !isSelected ? 0.5 : 1,
        }}
      >
        <View
          className="w-10 h-10 rounded-full items-center justify-center mr-3"
          style={{ backgroundColor: CARD_BACKGROUND_LIGHT }}
        >
          <Ionicons name="trail-sign-outline" size={20} color={EARTH_GREEN} />
        </View>

        <View className="flex-1">
          <Text
            style={{
              fontFamily: "SourceSans3_600SemiBold",
              fontSize: 16,
              color: TEXT_PRIMARY_STRONG,
            }}
            numberOfLines={1}
          >
            {tripName}
          </Text>
          <Text
            style={{
              fontFamily: "SourceSans3_400Regular",
              fontSize: 13,
              color: TEXT_SECONDARY,
              marginTop: 2,
            }}
          >
            {startDate} – {endDate}
          </Text>
        </View>

        {isSelected && adding ? (
          <ActivityIndicator size="small" color={DEEP_FOREST} />
        ) : (
          <Ionicons name="chevron-forward" size={20} color={TEXT_SECONDARY} />
        )}
      </Pressable>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end">
        {/* Backdrop */}
        <Pressable
          className="absolute inset-0"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onPress={onClose}
        />

        {/* Content */}
        <View
          className="rounded-t-3xl overflow-hidden"
          style={{ backgroundColor: PARCHMENT, maxHeight: "70%" }}
        >
          <SafeAreaView edges={["bottom"]}>
            {/* Header */}
            <View
              className="flex-row items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: BORDER_SOFT }}
            >
              <Pressable onPress={onClose} hitSlop={10}>
                <Text
                  style={{
                    fontFamily: "SourceSans3_400Regular",
                    fontSize: 16,
                    color: EARTH_GREEN,
                  }}
                >
                  Cancel
                </Text>
              </Pressable>

              <Text
                style={{
                  fontFamily: "Raleway_700Bold",
                  fontSize: 17,
                  color: DEEP_FOREST,
                }}
              >
                Add to Packing List
              </Text>

              <View style={{ width: 50 }} />
            </View>

            {/* Gear Item Preview */}
            {gearItem && (
              <View
                className="px-4 py-3 border-b"
                style={{ borderColor: BORDER_SOFT, backgroundColor: CARD_BACKGROUND_LIGHT }}
              >
                <Text
                  style={{
                    fontFamily: "SourceSans3_400Regular",
                    fontSize: 12,
                    color: TEXT_SECONDARY,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  Adding
                </Text>
                <Text
                  style={{
                    fontFamily: "SourceSans3_600SemiBold",
                    fontSize: 15,
                    color: TEXT_PRIMARY_STRONG,
                    marginTop: 2,
                  }}
                  numberOfLines={1}
                >
                  {gearItem.name}
                </Text>
              </View>
            )}

            {/* Select Trip Label */}
            <View className="px-4 py-2">
              <Text
                style={{
                  fontFamily: "SourceSans3_600SemiBold",
                  fontSize: 13,
                  color: TEXT_SECONDARY,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Select a trip
              </Text>
            </View>

            {/* Trips List */}
            {activeTrips.length === 0 ? (
              <View className="items-center justify-center py-12 px-6">
                <Ionicons name="calendar-outline" size={48} color={EARTH_GREEN} />
                <Text
                  style={{
                    fontFamily: "Raleway_700Bold",
                    fontSize: 18,
                    color: DEEP_FOREST,
                    marginTop: 12,
                    textAlign: "center",
                  }}
                >
                  No upcoming trips
                </Text>
                <Text
                  style={{
                    fontFamily: "SourceSans3_400Regular",
                    fontSize: 14,
                    color: TEXT_SECONDARY,
                    marginTop: 8,
                    textAlign: "center",
                  }}
                >
                  Create a trip first to add gear to a packing list
                </Text>
              </View>
            ) : (
              <FlatList
                data={activeTrips}
                keyExtractor={(item) => item.id}
                renderItem={renderTrip}
                contentContainerStyle={{ paddingBottom: 40 }}
              />
            )}
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}
