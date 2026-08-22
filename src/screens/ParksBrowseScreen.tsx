/**
 * Parks Browse Screen
 * Plan > Campgrounds tab
 *
 * Notes:
 * - This file was broken by logs inserted before imports, duplicate React imports, and a hook call outside the component.
 * - This version is a full, safe overwrite that restores valid structure and keeps your existing UI intent.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  Keyboard,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as firestoreLimit,
  serverTimestamp,
  setDoc,
  updateDoc,
  query,
} from "firebase/firestore";

import { db, auth } from "../config/firebase";
import { useTripsStore } from "../state/tripsStore";
import { useUserStore } from "../state/userStore";

import { usePlanTabStore } from "../state/planTabStore";

// Components
import ParksMap from "../components/ParksMap";
import ParkFilterBar, { FilterMode, ParkType, DriveTime, SortOption, US_STATES } from "../components/ParkFilterBar";
import ParkListItem from "../components/ParkListItem";
import ParkDetailModal from "../components/ParkDetailModal";
import FireflyLoader from "../components/common/FireflyLoader";
import AccountRequiredModal from "../components/AccountRequiredModal";
import { requireAccount, requirePro } from "../utils/gating";
import { useToast } from "../components/ToastManager";

// Types
import { Park, TripDestination } from "../types/camping";
import { RootStackParamList } from "../navigation/types";

// Theme
import { colors, spacing, radius, fonts, fontSizes } from "../theme/theme";
import {
  DEEP_FOREST,
  EARTH_GREEN,
  GRANITE_GOLD,
  CARD_BACKGROUND_LIGHT,
  BORDER_SOFT,
  TEXT_SECONDARY,
  TEXT_MUTED,
} from "../constants/colors";

type ParksBrowseScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;
type ParksBrowseScreenRouteProp = RouteProp<RootStackParamList, "ParksBrowse">;

interface ParksBrowseScreenProps {
  onTabChange?: (tab: "trips" | "parks" | "weather") => void;
  selectedParkId?: string;
  onParkDetailClosed?: () => void;
}

type LatLng = { latitude: number; longitude: number };

// Normalize park type filter values to canonical format
function normalizeParkType(rawFilter: string | undefined | null): Park["filter"] {
  if (!rawFilter) return "private"; // default fallback for missing data

  const normalized = rawFilter.toLowerCase().trim().replace(/\s+/g, "_");

  // Map various formats to canonical values
  if (normalized.includes("state") && normalized.includes("park")) return "state_park";
  if (normalized === "state_park" || normalized === "statepark") return "state_park";

  if (normalized.includes("national") && normalized.includes("park")) return "national_park";
  if (normalized === "national_park" || normalized === "nationalpark") return "national_park";

  if (normalized.includes("national") && normalized.includes("forest")) return "national_forest";
  if (normalized === "national_forest" || normalized === "nationalforest") return "national_forest";

  // Army Corps of Engineers ("army_corps_of_engineers", "army corps", "usace", "corps of engineers")
  if (normalized.includes("corps") || normalized.includes("usace") || normalized.includes("army")) return "army_corps";

  // BLM / Bureau of Land Management
  if (normalized === "blm" || normalized.includes("blm") || normalized.includes("bureau_of_land")) return "blm";

  // Dispersed / boondocking / primitive roadside camping
  if (normalized.includes("dispersed") || normalized.includes("boondock")) return "dispersed";

  // Municipal / county / city / civic parks
  if (normalized.includes("municipal") || normalized.includes("county") || normalized.includes("city_park") || normalized.includes("civic")) return "county_park";

  // Private campgrounds (KOAs, private RV parks/resorts, etc.)
  if (normalized.includes("private")) return "private";

  // Log unexpected values in dev
  if (__DEV__) {
    console.warn(`[FILTER_DEBUG] ⚠️ Unknown filter value: "${rawFilter}" -> defaulting to private`);
  }
  return "private";
}

function mapDocToPark(id: string, data: any): Park {
  return {
    id,
    name: data.name || "",
    filter: normalizeParkType(data.filter),
    address: data.address || "",
    state: data.state || "",
    latitude: data.latitude || 0,
    longitude: data.longitude || 0,
    url: data.url || "",
  };
}

export default function ParksBrowseScreen({ onTabChange, selectedParkId: selectedParkIdProp, onParkDetailClosed }: ParksBrowseScreenProps) {
  console.log("[PLAN_TRACE] Enter ParksBrowseScreen");

  // Get route params for trip context (when opened from TripDetailScreen)
  const route = useRoute<ParksBrowseScreenRouteProp>();
  // Reached two ways: as the "Parks" tab inside PlanTopTabsNavigator (whose
  // hero header already applies the top safe-area inset), or as the
  // standalone root-stack "ParksBrowse" route (no chrome above it, needs
  // its own inset). Route name tells them apart at runtime.
  const safeAreaEdges = (route.name as string) === "Parks" ? [] : (["top"] as const);
  const tripIdFromRoute = route.params?.tripId;
  const returnTo = route.params?.returnTo;
  const selectedParkIdFromRoute = route.params?.selectedParkId;
  
  // Use selectedParkId from either route params or props
  const selectedParkIdToOpen = selectedParkIdFromRoute || selectedParkIdProp;
  
  // Get destination picker trip context from store (when navigated via Plan tab)
  const destinationPickerTripId = usePlanTabStore((s) => s.destinationPickerTripId);
  const setDestinationPickerTripId = usePlanTabStore((s) => s.setDestinationPickerTripId);
  
  // Use trip context from either route params or store
  const tripContextId = tripIdFromRoute || destinationPickerTripId;

  useEffect(() => {
    console.log("[PLAN_TRACE] ParksBrowseScreen mounted");
  }, []);

  // Handle selectedParkId - fetch and open park detail (from route params or prop)
  useEffect(() => {
    if (selectedParkIdToOpen) {
      fetchParkById(selectedParkIdToOpen);
    }
  }, [selectedParkIdToOpen]);

  const fetchParkById = async (parkId: string) => {
    // Direct doc lookup by ID rather than loading the (capped, unordered)
    // bulk parks list and searching client-side - a specific park can fall
    // outside that cap and silently fail to be found there.
    try {
      const snap = await getDoc(doc(db, "parks", parkId));
      if (snap.exists()) {
        setSelectedPark(mapDocToPark(snap.id, snap.data()));
      } else {
        console.error("[ParksBrowse] Park not found:", parkId);
        showError("This campsite couldn't be found. It may have been removed.");
      }
    } catch (error) {
      console.error("[ParksBrowse] Error fetching park by ID:", error);
      showError("Couldn't load this campsite. Please try again.");
    }
  };

  const navigation = useNavigation<ParksBrowseScreenNavigationProp>();

  // Filters and view mode
  const [mode, setMode] = useState<FilterMode>("distance");
  const [selectedState, setSelectedState] = useState("");
  const [driveTime, setDriveTime] = useState<DriveTime>(2 as DriveTime);
  const [parkType, setParkType] = useState<ParkType>("all" as ParkType);
  const [sortBy, setSortBy] = useState<SortOption>("distance");
  const [zipCode, setZipCode] = useState("");
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  // Name search, scoped to a single selected state (see state-mode UI
  // below) rather than searched nationally — with ~3000 parks and a lot of
  // reused names ("Pine Lake", "Mill Creek", etc.) across states, an
  // unscoped search would return noisy, ambiguous results. Disabled until
  // a state is chosen.
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchQuery(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Data and UI state
  const [parks, setParks] = useState<Park[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPark, setSelectedPark] = useState<Park | null>(null);

  // The full parks collection (~3000 docs) was being re-fetched from
  // Firestore on every single filter/sort change (state, park type, drive
  // time, sort order all trigger fetchParks). All of that filtering already
  // happens client-side after the fetch, so the raw collection only needs
  // to be fetched once per session and cached here — filter changes just
  // re-run the existing client-side filter/sort logic against this cache.
  const rawParksCacheRef = useRef<Park[] | null>(null);

  // Add campground + add to trip flow
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [showAddToTrip, setShowAddToTrip] = useState(false);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [isSavingCampground, setIsSavingCampground] = useState(false);

  const [newCampgroundName, setNewCampgroundName] = useState("");
  const [newCampgroundAddress, setNewCampgroundAddress] = useState("");
  const [newCampgroundUrl, setNewCampgroundUrl] = useState("");
  const [newCampgroundNotes, setNewCampgroundNotes] = useState("");
  // Geocoded coordinates for custom campground
  const [newCampgroundCoords, setNewCampgroundCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [newCampgroundPlaceId, setNewCampgroundPlaceId] = useState<string | null>(null);

  // Gating modal state
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [accountModalTriggerKey, setAccountModalTriggerKey] = useState<string | undefined>(undefined);
  
  // Custom campground info modal
  const [showCampgroundInfoModal, setShowCampgroundInfoModal] = useState(false);

  const trips = useTripsStore((s) => s.trips);
  const updateTrip = useTripsStore((s) => s.updateTrip);
  const setTripDestination = useTripsStore((s) => s.setTripDestination);
  const currentUser = useUserStore((s) => s.currentUser);
  const { showError, showSuccess } = useToast();

  /**
   * Convert Park filter field to display park type for TripDestination
   */
  const getParkTypeDisplay = useCallback((filter: string | undefined): TripDestination["parkType"] => {
    if (!filter) return "Other";
    const normalized = filter.toLowerCase().replace(/_/g, " ");
    if (normalized.includes("state") && normalized.includes("park")) return "State Park";
    if (normalized.includes("national") && normalized.includes("park")) return "National Park";
    if (normalized.includes("national") && normalized.includes("forest")) return "National Forest";
    if (normalized.includes("corps") || normalized.includes("usace") || normalized.includes("army")) return "Army Corps of Engineers";
    if (normalized.includes("blm")) return "BLM Land";
    if (normalized.includes("dispersed") || normalized.includes("boondock")) return "Dispersed Camping";
    if (normalized.includes("municipal") || normalized.includes("county") || normalized.includes("civic")) return "Municipal/County Park";
    if (normalized.includes("private")) return "Private Campground";
    return "Other";
  }, []);

  /**
   * Create a TripDestination from a Park for structured destination data
   */
  const createTripDestinationFromPark = useCallback((park: Park): TripDestination => {
    return {
      sourceType: "parks",
      placeId: park.id,
      name: park.name,
      addressLine1: park.address || null,
      city: null, // Parks don't have separate city field
      state: park.state || null,
      lat: park.latitude,
      lng: park.longitude,
      formattedAddress: park.address || null,
      parkType: getParkTypeDisplay(park.filter),
      url: park.url || null, // Reservation URL for "Reserve a Site" button
      updatedAt: new Date().toISOString(),
    };
  }, [getParkTypeDisplay]);

  // Haversine distance in miles
  const getDistance = useCallback((lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 3959;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }, []);

  const maxDistanceMiles = useMemo(() => {
    // mph approximation
    return Number(driveTime) * 55;
  }, [driveTime]);

  // Fetches the full parks collection once and caches it in
  // rawParksCacheRef — every filter/sort combination below re-runs against
  // this cached array instead of re-querying Firestore.
  const loadRawParks = useCallback(async (): Promise<Park[]> => {
    if (rawParksCacheRef.current) {
      return rawParksCacheRef.current;
    }

    const parksCollection = collection(db, "parks");
    const q = query(parksCollection, firestoreLimit(3000));
    const querySnapshot = await getDocs(q);

    console.log("[ParksBrowse] Firebase returned", querySnapshot.size, "documents");

    const fetched: Park[] = [];

    // Track unique filter values and counts for debugging
    const filterValueCounts: Record<string, number> = {};
    const samplesByType: Record<string, string[]> = {};

    querySnapshot.forEach((d) => {
      const data: any = d.data();
      const rawFilter = data.filter;

      // Count raw filter values (including undefined/null) for debugging
      const filterKey = rawFilter ?? "(undefined)";
      filterValueCounts[filterKey] = (filterValueCounts[filterKey] || 0) + 1;

      // Store sample park names for each type (first 3)
      if (!samplesByType[filterKey]) samplesByType[filterKey] = [];
      if (samplesByType[filterKey].length < 3) {
        samplesByType[filterKey].push(data.name || "(no name)");
      }

      fetched.push(mapDocToPark(d.id, data));
    });

    // === DEV DEBUG: Park Type Analysis ===
    if (__DEV__) {
      console.log("\n========== PARK TYPE FILTER DEBUG ==========");
      console.log("[FILTER_DEBUG] Total parks loaded:", fetched.length);
      console.log("[FILTER_DEBUG] Raw 'filter' values found in Firestore data:");
      Object.entries(filterValueCounts).forEach(([value, count]) => {
        console.log(`  - "${value}": ${count} parks`);
        console.log(`    Samples: ${samplesByType[value]?.join(", ")}`);
      });

      // Count after normalization
      const normalizedCounts = {
        state_park: fetched.filter(p => p.filter === "state_park").length,
        national_park: fetched.filter(p => p.filter === "national_park").length,
        national_forest: fetched.filter(p => p.filter === "national_forest").length,
        private: fetched.filter(p => p.filter === "private").length,
        army_corps: fetched.filter(p => p.filter === "army_corps").length,
        county_park: fetched.filter(p => p.filter === "county_park").length,
        blm: fetched.filter(p => p.filter === "blm").length,
        dispersed: fetched.filter(p => p.filter === "dispersed").length,
      };
      console.log("[FILTER_DEBUG] Counts AFTER normalization:");
      console.log(`  - state_park: ${normalizedCounts.state_park}`);
      console.log(`  - national_park: ${normalizedCounts.national_park}`);
      console.log(`  - national_forest: ${normalizedCounts.national_forest}`);
      console.log(`  - private: ${normalizedCounts.private}`);
      console.log(`  - army_corps: ${normalizedCounts.army_corps}`);
      console.log(`  - county_park: ${normalizedCounts.county_park}`);
      console.log(`  - blm: ${normalizedCounts.blm}`);
      console.log(`  - dispersed: ${normalizedCounts.dispersed}`);
      console.log("=============================================\n");
    }

    rawParksCacheRef.current = fetched;
    return fetched;
  }, []);

  const fetchParks = useCallback(async () => {
    // Only fetch after user has initiated search or location flow
    if (!hasSearched) {
      console.log("[ParksBrowse] Waiting for user to initiate search");
      return;
    }

    if (mode === "distance" && !userLocation) {
      console.log("[ParksBrowse] Distance mode requires location");
      return;
    }

    if (mode === "state" && !selectedState) {
      console.log("[ParksBrowse] State mode requires state selection");
      setParks([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let fetched: (Park & { distance?: number })[] = await loadRawParks();

      if (__DEV__) {
        console.log("[FILTER_DEBUG] Current UI filter selection:", parkType);
      }

      // Filter by state
      if (mode === "state" && selectedState) {
        const beforeStateFilter = fetched.length;
        // Get the full state name from US_STATES mapping
        const stateEntry = US_STATES.find((s) => s.value === selectedState);
        const fullStateName = stateEntry?.label || selectedState;
        
        fetched = fetched.filter((p) => {
          const parkState = (p.state || "").toUpperCase();
          // Match either abbreviation (e.g., "IL") or full name (e.g., "Illinois")
          return parkState === selectedState.toUpperCase() || 
                 parkState === fullStateName.toUpperCase();
        });
        if (__DEV__) {
          console.log(`[FILTER_DEBUG] State filter "${selectedState}" (${fullStateName}): ${beforeStateFilter} -> ${fetched.length} parks`);
        }
      }

      // Filter by search query — only meaningful once a state has scoped
      // the list down, so this only applies in state mode (search UI is
      // disabled until a state is picked; see render below).
      if (mode === "state" && selectedState && debouncedSearchQuery) {
        const beforeSearchFilter = fetched.length;
        const needle = debouncedSearchQuery.toLowerCase();
        fetched = fetched.filter((p) => p.name.toLowerCase().includes(needle));
        if (__DEV__) {
          console.log(`[FILTER_DEBUG] Search filter "${debouncedSearchQuery}": ${beforeSearchFilter} -> ${fetched.length} parks`);
        }
      }

      // Filter by park type
      if (parkType !== ("all" as any)) {
        const beforeTypeFilter = fetched.length;
        fetched = fetched.filter((p) => p.filter === parkType);
        if (__DEV__) {
          console.log(`[FILTER_DEBUG] Type filter "${parkType}": ${beforeTypeFilter} -> ${fetched.length} parks`);
          if (fetched.length === 0) {
            console.warn(`[FILTER_DEBUG] ⚠️ No parks match filter "${parkType}"! Check data values.`);
          }
        }
      }

      // Distance mode - filter and sort by distance
      if (mode === "distance" && userLocation) {
        const beforeDistanceFilter = fetched.length;
        fetched = fetched
          .map((p) => ({
            ...p,
            distance: getDistance(userLocation.latitude, userLocation.longitude, p.latitude, p.longitude),
          }))
          .filter((p) => (p.distance ?? 999999) <= maxDistanceMiles);

        if (__DEV__) {
          console.log(`[FILTER_DEBUG] Distance filter (${maxDistanceMiles} mi): ${beforeDistanceFilter} -> ${fetched.length} parks`);
          console.log(`[FILTER_DEBUG] User location: lat=${userLocation.latitude.toFixed(4)}, lng=${userLocation.longitude.toFixed(4)}`);
          if (fetched.length > 0 && fetched.length <= 5) {
            console.log("[FILTER_DEBUG] Parks in range:");
            fetched.forEach(p => console.log(`  - ${p.name} (${p.filter}): ${p.distance?.toFixed(1)} mi`));
          }
        }

        // Sort based on user preference
        if (sortBy === "name") {
          fetched = fetched.sort((a, b) => a.name.localeCompare(b.name));
        } else {
          fetched = fetched.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
        }

        console.log("[ParksBrowse] Found", fetched.length, "parks within", driveTime, "hours (", maxDistanceMiles, "mi )");
      }

      // State mode - sort alphabetically by name
      if (mode === "state" && selectedState) {
        fetched = fetched.sort((a, b) => a.name.localeCompare(b.name));
      }

      console.log("[ParksBrowse] Final parks count:", fetched.length);
      setParks(fetched);
    } catch (err: any) {
      console.error("Error fetching parks:", err?.code, err?.message, err);
      setError("Failed to load parks. Please check your connection and try again.");
      setParks([]);
    } finally {
      setIsLoading(false);
    }
  }, [hasSearched, mode, selectedState, debouncedSearchQuery, userLocation, driveTime, parkType, sortBy, maxDistanceMiles, getDistance, loadRawParks]);

  useEffect(() => {
    fetchParks();
  }, [fetchParks]);

  useEffect(() => {
    console.log("[ParksBrowseScreen] Loading state changed, isLoading:", isLoading);
  }, [isLoading]);

  const handleModeChange = (newMode: FilterMode) => {
    console.log("[ParksBrowseScreen] Mode changed to:", newMode);

    if (newMode !== mode) {
      setMode(newMode);
      setSelectedState("");
      setSearchQuery("");
      setParkType("all" as ParkType);
      setError(null);
      setParks([]);
      // Returning to distance mode with a location we already have should
      // immediately re-browse with it, not drop back to a dead empty state
      // that only a fresh "Use my location" tap can recover from.
      setHasSearched(newMode === "distance" && !!userLocation);
    }
  };

  const handleLocationRequest = (location: LatLng) => {
    console.log("[ParksBrowseScreen] Location received:", location);
    setUserLocation(location);
    setHasSearched(true);
  };

  const handleLocationError = (errorMsg: string) => {
    console.log("[ParksBrowseScreen] Location error:", errorMsg);
    setError(errorMsg);
  };

  // Geocode zip code to coordinates
  const handleZipCodeSubmit = async () => {
    if (!zipCode || zipCode.length !== 5) {
      setError("Please enter a valid 5-digit zip code");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      
      // Use expo-location's geocoding
      const geocoded = await Location.geocodeAsync(`${zipCode}, USA`);
      
      if (geocoded && geocoded.length > 0) {
        const { latitude, longitude } = geocoded[0];
        setUserLocation({ latitude, longitude });
        setHasSearched(true);
        console.log("[ParksBrowseScreen] Geocoded zip to:", latitude, longitude);
      } else {
        setError("Could not find location for this zip code");
      }
    } catch (err) {
      console.error("[ParksBrowseScreen] Geocode error:", err);
      setError("Failed to look up zip code. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleParkPress = (park: Park) => setSelectedPark(park);

  const handleAddCampground = () => {
    // Gate: PRO required to add custom campgrounds
    if (!requirePro({
      openAccountModal: () => setShowAccountModal(true),
      openPaywallModal: (variant) => navigation.navigate("Paywall", { triggerKey: "custom_campsite", variant }),
    })) {
      return;
    }
    setAddModalVisible(true);
  };

  const handleCloseAddCampground = () => {
    setAddModalVisible(false);
    // Reset form fields when closing
    setNewCampgroundName("");
    setNewCampgroundAddress("");
    setNewCampgroundUrl("");
    setNewCampgroundNotes("");
    setNewCampgroundCoords(null);
    setNewCampgroundPlaceId(null);
  };

  const handleSaveCampground = async () => {
    if (!currentUser) {
      showError("You must be logged in to save a campground.");
      return;
    }
    if (!newCampgroundName.trim()) {
      showError("Campground name is required.");
      return;
    }
    if (!newCampgroundAddress.trim()) {
      showError("Full address is required for weather and navigation.");
      return;
    }

    setIsSavingCampground(true);

    try {
      const placeId = `custom_${currentUser.id}_${Date.now()}`;
      
      // Geocode the address to get lat/lng for Weather and other features
      let geocodedLat: number | null = null;
      let geocodedLng: number | null = null;
      
      try {
        const geocodeResults = await Location.geocodeAsync(newCampgroundAddress.trim());
        if (geocodeResults && geocodeResults.length > 0) {
          geocodedLat = geocodeResults[0].latitude;
          geocodedLng = geocodeResults[0].longitude;
          console.log("[ParksBrowse] Geocoded custom campground:", geocodedLat, geocodedLng);
        } else {
          console.warn("[ParksBrowse] Could not geocode address, continuing without coordinates");
        }
      } catch (geocodeErr) {
        console.warn("[ParksBrowse] Geocoding failed:", geocodeErr);
        // Continue without coordinates - user can still use the campground
      }
      
      const placeData = {
        placeId,
        name: newCampgroundName.trim(),
        placeType: "campground",
        source: "user",
        address: newCampgroundAddress.trim(),
        url: newCampgroundUrl.trim() || null,
        notes: newCampgroundNotes.trim() || null,
        latitude: geocodedLat,
        longitude: geocodedLng,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, "users", currentUser.id, "savedPlaces", placeId), placeData);

      // Store coordinates and placeId for use when adding to trip
      setNewCampgroundCoords(geocodedLat && geocodedLng ? { lat: geocodedLat, lng: geocodedLng } : null);
      setNewCampgroundPlaceId(placeId);
      
      setAddModalVisible(false);
      setShowAddToTrip(true);

      // NOTE: Don't clear inputs yet - we need them for handleConfirmAddToTrip
      
      if (!geocodedLat || !geocodedLng) {
        showError("Campground saved, but we couldn\u2019t find coordinates for this address. Weather features may not work. You can add it to a trip now.");
      } else {
        showSuccess("Campground saved! Now select a trip to add it to.");
      }
    } catch (err) {
      console.error("Error saving campground:", err);
      showError("Failed to save campground. Please try again.");
    } finally {
      setIsSavingCampground(false);
    }
  };

  const handleConfirmAddToTrip = async () => {
    if (!currentUser) return;
    if (!selectedTripId) return;

    try {
      const trip = trips.find((t: any) => t.id === selectedTripId);
      if (!trip) return;

      // Create TripDestination for the custom campground
      const tripDestination: TripDestination = {
        sourceType: "custom",
        placeId: newCampgroundPlaceId,
        name: newCampgroundName.trim() || "Custom campground",
        addressLine1: newCampgroundAddress.trim() || null,
        city: null, // Could parse from address if needed
        state: null, // Could parse from address if needed
        lat: newCampgroundCoords?.lat ?? null,
        lng: newCampgroundCoords?.lng ?? null,
        formattedAddress: newCampgroundAddress.trim() || null,
        parkType: "Other",
        updatedAt: new Date().toISOString(),
      };

      // Also keep legacy customCampgrounds array for backward compatibility
      const nowId = `${currentUser.id}_${Date.now()}`;
      const newItem = { id: nowId, name: newCampgroundName.trim() || "Custom campground" };
      const updatedCampgrounds = Array.isArray((trip as any).customCampgrounds)
        ? [...(trip as any).customCampgrounds, newItem]
        : [newItem];

      // Update trip with new tripDestination and legacy customCampgrounds
      await updateTrip((trip as any).id, {
        tripDestination,
        customCampgrounds: updatedCampgrounds,
      } as any);

      // Haptic success feedback
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Clear form state
      setNewCampgroundName("");
      setNewCampgroundAddress("");
      setNewCampgroundUrl("");
      setNewCampgroundNotes("");
      setNewCampgroundCoords(null);
      setNewCampgroundPlaceId(null);
      
      setShowAddToTrip(false);
      setSelectedTripId(null);

      showSuccess(`"${tripDestination.name}" is now the destination for "${trip.name}"`);
    } catch (err) {
      console.error("Error adding campground to trip:", err);
      showError("Failed to add campground to trip. Please try again.");
    }
  };

  const showEmptyState = !isLoading && parks.length === 0 && hasSearched;
  const showLocationPrompt = mode === "distance" && !userLocation && !isLoading;
  const showInitialState = !hasSearched && !isLoading && parks.length === 0;

  return (
    <SafeAreaView style={styles.root} edges={safeAreaEdges}>
      {/* Add to Trip Modal */}
      <Modal
        visible={showAddToTrip}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAddToTrip(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add campground to a trip</Text>

            {trips.length === 0 ? (
              <Text style={{ marginBottom: 20, color: "#111" }}>You have no trips. Create a trip first.</Text>
            ) : (
              <>
                <Text style={{ marginBottom: 8, color: "#111" }}>Select a trip:</Text>

                {trips.map((trip: any) => (
                  <TouchableOpacity
                    key={trip.id}
                    onPress={() => setSelectedTripId(trip.id)}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      borderRadius: 8,
                      backgroundColor: selectedTripId === trip.id ? DEEP_FOREST : CARD_BACKGROUND_LIGHT,
                      marginBottom: 8,
                      borderWidth: 1,
                      borderColor: BORDER_SOFT,
                    }}
                  >
                    <Text
                      style={{
                        color: selectedTripId === trip.id ? "#fff" : DEEP_FOREST,
                        fontFamily: fonts.bodySemibold,
                      }}
                    >
                      {trip.name}
                    </Text>
                  </TouchableOpacity>
                ))}

                <TouchableOpacity
                  onPress={handleConfirmAddToTrip}
                  style={{
                    backgroundColor: DEEP_FOREST,
                    borderRadius: 8,
                    paddingVertical: 8,
                    paddingHorizontal: 16,
                    marginTop: 12,
                    alignItems: "center",
                    opacity: selectedTripId ? 1 : 0.5,
                  }}
                  disabled={!selectedTripId}
                >
                  <Text style={{ color: "#fff", fontFamily: fonts.bodySemibold, fontSize: 14 }}>Add to trip</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setShowAddToTrip(false)} style={{ paddingVertical: 8, paddingHorizontal: 12, marginTop: 8, alignSelf: "center" }}>
                  <Text style={{ color: DEEP_FOREST, fontFamily: fonts.bodySemibold, fontSize: 14 }}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Add Campground Modal */}
      <Modal
        visible={addModalVisible}
        animationType="slide"
        transparent
        onRequestClose={handleCloseAddCampground}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: "#F4EBD0" }]}>
            {/* Header */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md }}>
              <Text style={{ fontFamily: fonts.displayBold, fontSize: 20, color: DEEP_FOREST }}>
                Add your campground
              </Text>
              <TouchableOpacity onPress={handleCloseAddCampground} style={{ padding: 4 }}>
                <Ionicons name="close" size={24} color={DEEP_FOREST} />
              </TouchableOpacity>
            </View>

            {/* Campground Name */}
            <View style={{ marginBottom: spacing.sm }}>
              <Text style={{ fontFamily: fonts.bodySemibold, fontSize: fontSizes.sm, color: DEEP_FOREST, marginBottom: 6 }}>
                Campground Name *
              </Text>
              <TextInput
                placeholder="e.g., Shady Pines Campground"
                value={newCampgroundName}
                onChangeText={setNewCampgroundName}
                style={{
                  backgroundColor: "#fff",
                  borderWidth: 1,
                  borderColor: BORDER_SOFT,
                  borderRadius: radius.md,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  fontFamily: fonts.bodyRegular,
                  fontSize: fontSizes.sm,
                  color: DEEP_FOREST,
                }}
                placeholderTextColor={TEXT_MUTED}
              />
            </View>

            {/* Address */}
            <View style={{ marginBottom: spacing.sm }}>
              <Text style={{ fontFamily: fonts.bodySemibold, fontSize: fontSizes.sm, color: DEEP_FOREST, marginBottom: 6 }}>
                Address *
              </Text>
              <TextInput
                placeholder="Full address for navigation"
                value={newCampgroundAddress}
                onChangeText={setNewCampgroundAddress}
                style={{
                  backgroundColor: "#fff",
                  borderWidth: 1,
                  borderColor: BORDER_SOFT,
                  borderRadius: radius.md,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  fontFamily: fonts.bodyRegular,
                  fontSize: fontSizes.sm,
                  color: DEEP_FOREST,
                }}
                placeholderTextColor={TEXT_MUTED}
              />
            </View>

            {/* URL */}
            <View style={{ marginBottom: spacing.sm }}>
              <Text style={{ fontFamily: fonts.bodySemibold, fontSize: fontSizes.sm, color: DEEP_FOREST, marginBottom: 6 }}>
                Website (optional)
              </Text>
              <TextInput
                placeholder="https://..."
                value={newCampgroundUrl}
                onChangeText={setNewCampgroundUrl}
                autoCapitalize="none"
                keyboardType="url"
                style={{
                  backgroundColor: "#fff",
                  borderWidth: 1,
                  borderColor: BORDER_SOFT,
                  borderRadius: radius.md,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  fontFamily: fonts.bodyRegular,
                  fontSize: fontSizes.sm,
                  color: DEEP_FOREST,
                }}
                placeholderTextColor={TEXT_MUTED}
              />
            </View>

            {/* Notes */}
            <View style={{ marginBottom: spacing.md }}>
              <Text style={{ fontFamily: fonts.bodySemibold, fontSize: fontSizes.sm, color: DEEP_FOREST, marginBottom: 6 }}>
                Notes (optional)
              </Text>
              <TextInput
                placeholder="Any additional details..."
                value={newCampgroundNotes}
                onChangeText={setNewCampgroundNotes}
                multiline
                style={{
                  backgroundColor: "#fff",
                  borderWidth: 1,
                  borderColor: BORDER_SOFT,
                  borderRadius: radius.md,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  fontFamily: fonts.bodyRegular,
                  fontSize: fontSizes.sm,
                  color: DEEP_FOREST,
                  minHeight: 80,
                  textAlignVertical: "top",
                }}
                placeholderTextColor={TEXT_MUTED}
              />
            </View>

            {/* Buttons */}
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 12 }}>
              <TouchableOpacity 
                onPress={handleCloseAddCampground} 
                style={{ paddingVertical: 8, paddingHorizontal: 12 }}
                disabled={isSavingCampground}
              >
                <Text style={{ color: DEEP_FOREST, fontFamily: fonts.bodySemibold, fontSize: 14, opacity: isSavingCampground ? 0.5 : 1 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveCampground}
                disabled={isSavingCampground}
                style={{ 
                  backgroundColor: DEEP_FOREST, 
                  borderRadius: 8, 
                  paddingVertical: 8, 
                  paddingHorizontal: 16,
                  opacity: isSavingCampground ? 0.7 : 1,
                }}
              >
                <Text style={{ color: colors.parchment, fontFamily: fonts.bodySemibold, fontSize: 14 }}>
                  {isSavingCampground ? "Saving..." : "Save"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Main Content */}
      <View style={{ flex: 1, backgroundColor: "#F4EBD0" }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.md,
            paddingBottom: spacing.xl,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Filter Bar */}
          <ParkFilterBar
            mode={mode}
            onModeChange={handleModeChange}
            selectedState={selectedState}
            onStateChange={(state) => {
              setSelectedState(state);
              setSearchQuery("");
              setHasSearched(true);
            }}
            driveTime={driveTime}
            onDriveTimeChange={setDriveTime}
            parkType={parkType}
            onParkTypeChange={setParkType}
            sortBy={sortBy}
            onSortChange={setSortBy}
            zipCode={zipCode}
            onZipCodeChange={setZipCode}
            onZipCodeSubmit={handleZipCodeSubmit}
            onLocationRequest={handleLocationRequest}
            onLocationError={handleLocationError}
            hasLocation={!!userLocation}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />

          {/* Search by park name — scoped to the selected state. Disabled
              (with an explanatory placeholder) until a state is chosen, so
              search never runs an ambiguous, unscoped query across ~3000
              parks nationally. */}
          {mode === "state" && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: selectedState ? CARD_BACKGROUND_LIGHT : `${CARD_BACKGROUND_LIGHT}80`,
                borderWidth: 1,
                borderColor: BORDER_SOFT,
                borderRadius: radius.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                marginBottom: spacing.md,
              }}
            >
              <Ionicons
                name="search"
                size={18}
                color={selectedState ? TEXT_SECONDARY : TEXT_MUTED}
                style={{ marginRight: spacing.xs }}
              />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                editable={!!selectedState}
                placeholder={
                  selectedState
                    ? `Search parks in ${US_STATES.find((s) => s.value === selectedState)?.label || selectedState}...`
                    : "Select a state to search parks by name"
                }
                placeholderTextColor={TEXT_MUTED}
                returnKeyType="search"
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={() => Keyboard.dismiss()}
                style={{
                  flex: 1,
                  fontFamily: fonts.bodyRegular,
                  fontSize: fontSizes.sm,
                  color: DEEP_FOREST,
                }}
              />
              {searchQuery.length > 0 && (
                <Pressable
                  onPress={() => setSearchQuery("")}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-circle" size={18} color={TEXT_MUTED} />
                </Pressable>
              )}
            </View>
          )}

          {/* Add Private Campground Link */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: spacing.md }}>
            <TouchableOpacity
              onPress={handleAddCampground}
            >
              <Text style={{ fontFamily: fonts.bodySemibold, fontSize: fontSizes.sm, color: EARTH_GREEN }}>
                + Add your own campground
              </Text>
            </TouchableOpacity>
            <Pressable
              onPress={() => setShowCampgroundInfoModal(true)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
                marginLeft: -8,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons name="information-circle-outline" size={20} color={EARTH_GREEN} />
            </Pressable>
          </View>

          {/* Error */}
          {error && (
            <View
              style={{
                backgroundColor: "#FEE2E2",
                borderRadius: radius.md,
                padding: spacing.md,
                marginBottom: spacing.md,
                borderWidth: 1,
                borderColor: "#FCA5A5",
              }}
            >
              <Text style={{ fontFamily: fonts.bodyRegular, fontSize: fontSizes.sm, color: "#991B1B" }}>
                {error}
              </Text>
            </View>
          )}

          {/* Initial state - Find your next campsite */}
          {showInitialState && (
            <View
              style={{
                backgroundColor: CARD_BACKGROUND_LIGHT,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: BORDER_SOFT,
                padding: spacing.xl,
                alignItems: "center",
              }}
            >
              <View
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 30,
                  backgroundColor: `${DEEP_FOREST}15`,
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: spacing.sm,
                }}
              >
                <Ionicons name="compass-outline" size={30} color={DEEP_FOREST} />
              </View>
              <Text
                style={{
                  fontFamily: fonts.displayRegular,
                  fontSize: fontSizes.md,
                  color: DEEP_FOREST,
                  marginBottom: spacing.xs,
                }}
              >
                Find your next campsite.
              </Text>
              <Text
                style={{
                  fontFamily: fonts.bodyRegular,
                  fontSize: fontSizes.sm,
                  color: EARTH_GREEN,
                  textAlign: "center",
                }}
              >
                Your camp chair is getting restless.
              </Text>
            </View>
          )}

          {/* Map - Only show when map view is selected */}
          {viewMode === "map" && !showLocationPrompt && !showInitialState && (mode !== "distance" || userLocation) && (
            <View style={{ marginBottom: spacing.md }}>
              <ParksMap parks={parks} userLocation={userLocation} mode={mode} onParkPress={handleParkPress} />
            </View>
          )}

          {/* List - Only show when list view is selected */}
          {viewMode === "list" && !isLoading && parks.length > 0 && (
            <View>
              <Text
                style={{
                  fontFamily: fonts.displaySemibold,
                  fontSize: fontSizes.md,
                  color: DEEP_FOREST,
                  marginBottom: spacing.sm,
                }}
              >
                {parks.length} {parks.length === 1 ? "park" : "parks"} found
              </Text>
              {parks.map((park, index) => (
                <ParkListItem key={park.id} park={park} onPress={handleParkPress} index={index} />
              ))}
            </View>
          )}

          {/* Empty */}
          {showEmptyState && !showLocationPrompt && !showInitialState && (
            <View
              style={{
                backgroundColor: CARD_BACKGROUND_LIGHT,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: BORDER_SOFT,
                padding: spacing.xl,
                alignItems: "center",
              }}
            >
              <View
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 30,
                  backgroundColor: `${DEEP_FOREST}15`,
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: spacing.sm,
                }}
              >
                <Ionicons name="search-outline" size={30} color={DEEP_FOREST} />
              </View>
              <Text
                style={{
                  fontFamily: fonts.displaySemibold,
                  fontSize: fontSizes.lg,
                  color: DEEP_FOREST,
                  marginBottom: spacing.xs,
                }}
              >
                No parks found
              </Text>
              <Text
                style={{
                  fontFamily: fonts.bodyRegular,
                  fontSize: fontSizes.md,
                  color: EARTH_GREEN,
                  textAlign: "center",
                  marginBottom: spacing.sm,
                }}
              >
                {mode === "distance"
                  ? "Try increasing your drive time or changing the park type filter."
                  : debouncedSearchQuery
                  ? `No parks matched "${debouncedSearchQuery}" in ${US_STATES.find((s) => s.value === selectedState)?.label || selectedState}. Try a different search term.`
                  : "Try selecting a different state or adjusting your filters."}
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Park Detail Modal */}
        <ParkDetailModal
          visible={!!selectedPark}
          park={selectedPark}
          onClose={() => {
            setSelectedPark(null);
            onParkDetailClosed?.();
          }}
          tripIdForDestination={tripContextId ?? undefined}
          onSetAsDestination={async (park, tripId) => {
            // DESTINATION PICKER FLOW: Save park as trip destination and return to TripDetail
            console.log("[ParksBrowse] Setting destination for trip:", tripId, "Park:", park.name);
            
            const userId = auth.currentUser?.uid;
            if (!userId) {
              showError("You must be logged in to set a destination.");
              return;
            }
            
            try {
              // 1. Build the destination object
              const tripDestination = createTripDestinationFromPark(park);
              
              // 2. Update Firestore (use setDoc with merge to handle trips not yet synced)
              const tripRef = doc(db, "users", userId, "trips", tripId);
              await setDoc(tripRef, {
                tripDestination,
                parkId: park.id, // Keep for legacy compatibility
                updatedAt: serverTimestamp(),
              }, { merge: true });
              
              // 3. Update local store for instant UI update
              await setTripDestination(tripId, tripDestination, park.id);

              console.log("[ParksBrowse] Destination saved successfully");
              
              // 4. Close modal
              setSelectedPark(null);
              onParkDetailClosed?.();
              
              // 5. Clear destination picker context and navigate back to TripDetail
              if (destinationPickerTripId) {
                setDestinationPickerTripId(null);
                navigation.navigate("TripDetail", { tripId, destinationJustSet: true });
              } else if (returnTo === "TripDetail") {
                navigation.goBack();
              }
            } catch (error: any) {
              console.error("[ParksBrowse] Failed to set destination:", error);
              showError(`Failed to save destination: ${error.code || "Unknown error"} ${error.message || ""}`);
            }
          }}
          onAddToTrip={async (park, tripId) => {
            if (tripId) {
              // Add park as structured tripDestination to existing trip
              console.log("[ParksBrowse] Setting tripDestination for trip:", tripId, "Park:", park.name);
              const tripDestination = createTripDestinationFromPark(park);
              try {
                await updateTrip(tripId, {
                  tripDestination,
                  parkId: park.id, // Keep for legacy compatibility
                });
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                setSelectedPark(null);
                onParkDetailClosed?.();
              } catch (error: any) {
                console.error("[ParksBrowse] Failed to add park to trip:", error);
                showError(error?.message || "Failed to add this park to the trip. Please try again.");
              }
            } else {
              // Create new trip flow - user will set destination after trip creation
              console.log("[ParksBrowse] Create new trip for park:", park.name);
              
              // First check if user has an account
              const hasAccount = requireAccount({
                showAccountPrompt: () => {},
                openAccountModal: () => setShowAccountModal(true),
              });
              if (!hasAccount) {
                setSelectedPark(null);
                onParkDetailClosed?.();
                return;
              }
              
              // Navigate to create trip — CreateTripScreen handles entitlement gating
              setSelectedPark(null);
              onParkDetailClosed?.();
              navigation.navigate("CreateTrip" as never);
            }
          }}
          onRequireAccount={(triggerKey) => {
            setAccountModalTriggerKey(triggerKey);
            setShowAccountModal(true);
          }}
          onRequirePro={(triggerKey, variant) => {
            setSelectedPark(null);
            onParkDetailClosed?.();
            navigation.navigate("Paywall", { triggerKey, variant });
          }}
          onCheckWeather={(park: Park) => {
            console.log("Check weather for park:", park.name);
            setSelectedPark(null);
            onParkDetailClosed?.();
            if (onTabChange) onTabChange("weather");
          }}
        />

        {/* Loader overlay - inside body content area */}
        {isLoading && (
          <View style={styles.loaderOverlay}>
            <FireflyLoader />
          </View>
        )}
      </View>

      {/* Gating Modals */}
      <AccountRequiredModal
        visible={showAccountModal}
        triggerKey={accountModalTriggerKey}
        onCreateAccount={() => {
          setShowAccountModal(false);
          setAccountModalTriggerKey(undefined);
          navigation.navigate("Auth" as never);
        }}
        onLogIn={() => {
          setShowAccountModal(false);
          setAccountModalTriggerKey(undefined);
          navigation.navigate("Auth" as never);
        }}
        onMaybeLater={() => {
          setShowAccountModal(false);
          setAccountModalTriggerKey(undefined);
        }}
      />

      {/* Custom Campground Info Modal */}
      <Modal
        visible={showCampgroundInfoModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCampgroundInfoModal(false)}
      >
        <Pressable
          style={styles.infoModalOverlay}
          onPress={() => setShowCampgroundInfoModal(false)}
        >
          <Pressable
            style={styles.infoModalContent}
            onPress={(e) => e.stopPropagation?.()}
          >
            <View style={styles.infoModalHeader}>
              <Ionicons name="information-circle" size={28} color={DEEP_FOREST} />
              <Text style={styles.infoModalTitle}>What is this for?</Text>
            </View>

            <Text style={styles.infoModalBody}>
              Use this to add private campgrounds that aren't in the national or state park system. Think campgrounds on private land, family property, farms, club campgrounds, or a friend's place.
            </Text>

            <Text style={styles.infoModalNote}>
              Custom campgrounds are private to you.
            </Text>

            <Pressable
              onPress={() => setShowCampgroundInfoModal(false)}
              style={({ pressed }) => [
                styles.infoModalButton,
                { opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={styles.infoModalButtonText}>Got it</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    position: "relative",
    backgroundColor: "#F4EBD0",
  },
  loaderOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
    elevation: 1000,
    pointerEvents: "none",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    width: "90%",
    borderWidth: 1,
    borderColor: BORDER_SOFT,
  },
  modalTitle: {
    fontFamily: fonts.bodySemibold,
    fontSize: 20,
    marginBottom: 16,
    color: "#111",
  },
  input: {
    borderWidth: 1,
    borderColor: BORDER_SOFT,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    color: "#111",
  },
  // Custom campground info modal styles
  infoModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  infoModalContent: {
    backgroundColor: "#F4EBD0",
    borderRadius: 16,
    padding: 24,
    maxWidth: 340,
    width: "100%",
  },
  infoModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  infoModalTitle: {
    fontFamily: fonts.displaySemibold,
    fontSize: 18,
    color: "#1a1a1a",
    marginLeft: 8,
  },
  infoModalBody: {
    fontFamily: fonts.bodyRegular,
    fontSize: 16,
    color: "#666",
    lineHeight: 24,
    marginBottom: 12,
  },
  infoModalNote: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    color: EARTH_GREEN,
    fontStyle: "italic",
    marginBottom: 20,
  },
  infoModalButton: {
    backgroundColor: DEEP_FOREST,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  infoModalButtonText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 16,
    color: "#F4EBD0",
  },
});
