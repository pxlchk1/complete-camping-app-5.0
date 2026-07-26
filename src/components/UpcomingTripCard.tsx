import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { format } from "date-fns";
import { Trip } from "../state/tripsStore";
import { PARCHMENT } from "../constants/colors";

// Extracted from MyTripsScreen, where this markup was inlined separately
// from the shared TripCard used for past trips. Upcoming trips get this
// richer, actionable card (packing/meals quick actions, a "view details"
// CTA) since they're the trips a user is actively preparing for.
function formatDateRange(startISO: string, endISO: string): string {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const startStr = format(start, "MMM d");
  const endStr = format(end, "MMM d, yyyy");
  return `${startStr} – ${endStr}`;
}

export interface UpcomingTripCardProps {
  trip: Trip;
  onResume: (trip: Trip) => void;
  onMenu: (trip: Trip) => void;
  onPackingPress: (tripId: string) => void;
  onMealsPress: (tripId: string) => void;
}

export default function UpcomingTripCard({
  trip,
  onResume,
  onMenu,
  onPackingPress,
  onMealsPress,
}: UpcomingTripCardProps) {
  return (
    <View className="rounded-xl p-3 mb-2" style={{ backgroundColor: "#59625C" }}>
      <View className="flex-row items-start justify-between">
        <Pressable onPress={() => onResume(trip)} className="flex-1 mr-2 active:opacity-70">
          <Text className="text-base" style={{ fontFamily: "Raleway_700Bold", color: PARCHMENT }} numberOfLines={1}>
            {trip.name}
          </Text>
          <Text
            className="text-xs mt-0.5"
            style={{ fontFamily: "SourceSans3_400Regular", color: "rgba(255,255,255,0.7)" }}
            numberOfLines={1}
          >
            {formatDateRange(trip.startDate, trip.endDate)}
            {trip.destination?.name ? ` • ${trip.destination.name}` : ""}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onMenu(trip)}
          className="p-1.5 rounded-full active:opacity-80"
          style={{ backgroundColor: "rgba(255,255,255,0.15)" }}
        >
          <Ionicons name="ellipsis-horizontal" size={16} color={PARCHMENT} />
        </Pressable>
      </View>

      {/* View Trip Details CTA */}
      <Pressable onPress={() => onResume(trip)} className="mt-2 py-2 active:opacity-70" accessibilityLabel="View trip details">
        <Text style={{ fontFamily: "SourceSans3_600SemiBold", fontSize: 14, color: PARCHMENT }}>
          View trip details »
        </Text>
        <Text
          className="mt-0.5"
          style={{ fontFamily: "SourceSans3_400Regular", fontSize: 12, color: "rgba(255,255,255,0.6)" }}
        >
          Add destinations, itinerary links, and confirmations.
        </Text>
      </Pressable>

      {/* Compact Packing & Meals Buttons */}
      <View className="flex-row mt-3" style={{ gap: 8 }}>
        <Pressable
          onPress={() => onPackingPress(trip.id)}
          className="flex-1 flex-row items-center justify-center py-2 rounded-lg active:opacity-90"
          style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
        >
          <Ionicons name="bag" size={16} color={PARCHMENT} />
          <Text className="text-xs ml-1.5" style={{ fontFamily: "SourceSans3_600SemiBold", color: PARCHMENT }}>
            Packing
          </Text>
          {trip.packing && (
            <Text className="text-xs ml-1" style={{ fontFamily: "SourceSans3_400Regular", color: "rgba(255,255,255,0.6)" }}>
              ({trip.packing.itemsChecked}/{trip.packing.totalItems})
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => onMealsPress(trip.id)}
          className="flex-1 flex-row items-center justify-center py-2 rounded-lg active:opacity-90"
          style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
        >
          <Ionicons name="restaurant" size={16} color={PARCHMENT} />
          <Text className="text-xs ml-1.5" style={{ fontFamily: "SourceSans3_600SemiBold", color: PARCHMENT }}>
            Meals
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
