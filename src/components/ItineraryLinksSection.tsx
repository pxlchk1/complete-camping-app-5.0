/**
 * Itinerary Links Section
 * Displays trip itinerary links grouped by day with empty state
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, addDays, parseISO } from 'date-fns';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import {
  ItineraryLink,
  MOMENT_OPTIONS,
  CreateItineraryLinkData,
} from '../types/itinerary';
import {
  getItineraryLinks,
  createItineraryLink,
  updateItineraryLink,
  deleteItineraryLink,
  groupLinksByDay,
} from '../services/itineraryLinksService';
import { getProviderIcon } from '../utils/providerSniffer';
import AddItineraryLinkModal from './AddItineraryLinkModal';
import ConfirmationModal from './ConfirmationModal';
import { useToast } from './ToastManager';
import {
  DEEP_FOREST,
  EARTH_GREEN,
  PARCHMENT,
  CARD_BACKGROUND_LIGHT,
  BORDER_SOFT,
  TEXT_PRIMARY_STRONG,
  TEXT_SECONDARY,
  TEXT_MUTED,
} from '../constants/colors';

interface ItineraryLinksSectionProps {
  tripId: string;
  tripStartDate: string;
  tripEndDate: string;
  onAddLink?: () => void;
  // Firestore rules only allow the trip owner to write itineraryLinks -
  // members are read-only. Defaults to true so existing owner-only call
  // sites don't need to change; pass false explicitly for a shared-trip
  // viewer.
  canEditTrip?: boolean;
}

export default function ItineraryLinksSection({
  tripId,
  tripStartDate,
  tripEndDate,
  canEditTrip = true,
}: ItineraryLinksSectionProps) {
  const { show, showError } = useToast();
  const [links, setLinks] = useState<ItineraryLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingLink, setEditingLink] = useState<ItineraryLink | null>(null);
  const [actionsFor, setActionsFor] = useState<ItineraryLink | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ItineraryLink | null>(null);

  const loadLinks = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getItineraryLinks(tripId);
      setLinks(data);
    } catch (error) {
      console.error('Failed to load itinerary links:', error);
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    loadLinks();
  }, [loadLinks]);

  const handleAddLink = async (data: CreateItineraryLinkData) => {
    if (editingLink) {
      await updateItineraryLink(tripId, editingLink.id, data);
    } else {
      await createItineraryLink(tripId, data);
    }
    await loadLinks();
    setEditingLink(null);
  };

  const handleOpenLink = async (link: ItineraryLink) => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const canOpen = await Linking.canOpenURL(link.url);
      if (canOpen) {
        await Linking.openURL(link.url);
      } else {
        showError('Unable to open this URL.');
      }
    } catch {
      showError('Failed to open link.');
    }
  };

  const handleEditLink = (link: ItineraryLink) => {
    setEditingLink(link);
    setShowAddModal(true);
  };

  const confirmDeleteLink = async () => {
    if (!deleteTarget) return;
    const link = deleteTarget;
    try {
      await deleteItineraryLink(tripId, link.id);
      await loadLinks();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      showError('Failed to delete link.');
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleCopyLink = async (link: ItineraryLink) => {
    try {
      await Clipboard.setStringAsync(link.url);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      show('Link copied to clipboard.');
    } catch {
      showError('Failed to copy link.');
    }
  };

  const handleLinkActions = (link: ItineraryLink) => {
    setActionsFor(link);
  };

  const getDayLabel = (dayIndex: number): string => {
    const start = parseISO(tripStartDate);
    const date = addDays(start, dayIndex - 1);
    return `Day ${dayIndex} · ${format(date, 'EEE, MMM d')}`;
  };

  const getMomentLabel = (moment?: string): string => {
    if (!moment) return '';
    const option = MOMENT_OPTIONS.find((m) => m.value === moment);
    return option?.label || '';
  };

  const groupedLinks = groupLinksByDay(links);
  const isEmpty = links.length === 0;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="map-outline" size={20} color={DEEP_FOREST} />
          <Text style={styles.headerTitle}>Itinerary Links</Text>
        </View>
        {!isEmpty && canEditTrip && (
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setEditingLink(null);
              setShowAddModal(true);
            }}
            style={styles.addButton}
          >
            <Ionicons name="add" size={18} color={DEEP_FOREST} />
            <Text style={styles.addButtonText}>Add link</Text>
          </Pressable>
        )}
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={EARTH_GREEN} />
        </View>
      ) : isEmpty ? (
        /* Empty State */
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            {canEditTrip
              ? 'Trail maps, routes, permits, and plans, organized by day.'
              : 'No itinerary links added yet.'}
          </Text>
          {canEditTrip && (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setEditingLink(null);
                setShowAddModal(true);
              }}
              style={styles.emptyButton}
            >
              <Ionicons name="add-circle-outline" size={18} color={PARCHMENT} />
              <Text style={styles.emptyButtonText}>Add link</Text>
            </Pressable>
          )}
        </View>
      ) : (
        /* Populated State - Links grouped by day */
        <View style={styles.linksList}>
          {Array.from(groupedLinks.entries()).map(([dayIndex, dayLinks]) => (
            <View key={dayIndex} style={styles.dayGroup}>
              <Text style={styles.dayHeader}>{getDayLabel(dayIndex)}</Text>
              {dayLinks.map((link) => (
                <Pressable
                  key={link.id}
                  onPress={() => handleOpenLink(link)}
                  onLongPress={() => handleLinkActions(link)}
                  style={styles.linkRow}
                >
                  <View style={styles.linkIcon}>
                    <Ionicons
                      name={getProviderIcon(link.provider) as any}
                      size={18}
                      color={EARTH_GREEN}
                    />
                  </View>
                  <View style={styles.linkContent}>
                    <Text style={styles.linkTitle} numberOfLines={1}>
                      {link.title}
                    </Text>
                    {link.note && (
                      <Text style={styles.linkNote} numberOfLines={1}>
                        {link.note}
                      </Text>
                    )}
                    <View style={styles.linkMeta}>
                      <View style={styles.providerChip}>
                        <Text style={styles.providerChipText}>{link.providerLabel}</Text>
                      </View>
                      {link.moment && (
                        <Text style={styles.momentText}>{getMomentLabel(link.moment)}</Text>
                      )}
                    </View>
                  </View>
                  <Pressable
                    onPress={() => handleLinkActions(link)}
                    style={styles.moreButton}
                    hitSlop={8}
                  >
                    <Ionicons name="ellipsis-vertical" size={16} color={TEXT_MUTED} />
                  </Pressable>
                </Pressable>
              ))}
            </View>
          ))}
        </View>
      )}

      {/* Add/Edit Modal */}
      <AddItineraryLinkModal
        visible={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setEditingLink(null);
        }}
        onSave={handleAddLink}
        tripStartDate={tripStartDate}
        tripEndDate={tripEndDate}
        editingLink={editingLink}
      />

      {/* Link Actions Sheet */}
      <Modal
        visible={!!actionsFor}
        transparent
        animationType="fade"
        onRequestClose={() => setActionsFor(null)}
      >
        <Pressable style={styles.actionsOverlay} onPress={() => setActionsFor(null)}>
          <View style={styles.actionsSheet}>
            <Text style={styles.actionsTitle} numberOfLines={1}>
              {actionsFor?.title}
            </Text>
            <Pressable
              style={styles.actionsRow}
              onPress={() => {
                const link = actionsFor;
                setActionsFor(null);
                if (link) handleOpenLink(link);
              }}
            >
              <Text style={styles.actionsRowText}>Open</Text>
            </Pressable>
            <Pressable
              style={styles.actionsRow}
              onPress={() => {
                const link = actionsFor;
                setActionsFor(null);
                if (link) handleCopyLink(link);
              }}
            >
              <Text style={styles.actionsRowText}>Copy link</Text>
            </Pressable>
            {canEditTrip && (
              <>
                <Pressable
                  style={styles.actionsRow}
                  onPress={() => {
                    const link = actionsFor;
                    setActionsFor(null);
                    if (link) handleEditLink(link);
                  }}
                >
                  <Text style={styles.actionsRowText}>Edit</Text>
                </Pressable>
                <Pressable
                  style={styles.actionsRow}
                  onPress={() => {
                    const link = actionsFor;
                    setActionsFor(null);
                    if (link) setDeleteTarget(link);
                  }}
                >
                  <Text style={[styles.actionsRowText, styles.actionsRowDestructive]}>Delete</Text>
                </Pressable>
              </>
            )}
            <Pressable style={styles.actionsCancelRow} onPress={() => setActionsFor(null)}>
              <Text style={styles.actionsCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmationModal
        visible={!!deleteTarget}
        title="Delete link"
        message={deleteTarget ? `Are you sure you want to delete "${deleteTarget.title}"?` : undefined}
        primary={{ label: 'Delete', iconName: 'trash', onPress: confirmDeleteLink }}
        secondary={{ label: 'Cancel', onPress: () => setDeleteTarget(null) }}
        onClose={() => setDeleteTarget(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: CARD_BACKGROUND_LIGHT,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER_SOFT,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_SOFT,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: 'SourceSans3_600SemiBold',
    color: TEXT_PRIMARY_STRONG,
    marginLeft: 8,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#f0f9f4',
  },
  addButtonText: {
    fontSize: 13,
    fontFamily: 'SourceSans3_600SemiBold',
    color: DEEP_FOREST,
    marginLeft: 4,
  },
  loadingContainer: {
    padding: 24,
    alignItems: 'center',
  },
  emptyState: {
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'SourceSans3_400Regular',
    color: TEXT_SECONDARY,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: DEEP_FOREST,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  emptyButtonText: {
    fontSize: 14,
    fontFamily: 'SourceSans3_600SemiBold',
    color: PARCHMENT,
    marginLeft: 6,
  },
  linksList: {
    paddingVertical: 8,
  },
  dayGroup: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  dayHeader: {
    fontSize: 13,
    fontFamily: 'SourceSans3_600SemiBold',
    color: TEXT_MUTED,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_SOFT,
  },
  linkIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#f0f9f4',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  linkContent: {
    flex: 1,
    marginRight: 8,
  },
  linkTitle: {
    fontSize: 15,
    fontFamily: 'SourceSans3_600SemiBold',
    color: TEXT_PRIMARY_STRONG,
    marginBottom: 2,
  },
  linkNote: {
    fontSize: 13,
    fontFamily: 'SourceSans3_400Regular',
    color: TEXT_SECONDARY,
    marginBottom: 4,
  },
  linkMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  providerChip: {
    backgroundColor: '#e8f4ec',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  providerChipText: {
    fontSize: 11,
    fontFamily: 'SourceSans3_600SemiBold',
    color: EARTH_GREEN,
  },
  momentText: {
    fontSize: 12,
    fontFamily: 'SourceSans3_400Regular',
    color: TEXT_MUTED,
    marginLeft: 8,
  },
  moreButton: {
    padding: 4,
  },
  actionsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  actionsSheet: {
    backgroundColor: PARCHMENT,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  actionsTitle: {
    fontSize: 13,
    fontFamily: 'SourceSans3_600SemiBold',
    color: TEXT_MUTED,
    textAlign: 'center',
    marginBottom: 12,
  },
  actionsRow: {
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: BORDER_SOFT,
    alignItems: 'center',
  },
  actionsRowText: {
    fontSize: 16,
    fontFamily: 'SourceSans3_600SemiBold',
    color: TEXT_PRIMARY_STRONG,
  },
  actionsRowDestructive: {
    color: '#dc2626',
  },
  actionsCancelRow: {
    paddingVertical: 14,
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: CARD_BACKGROUND_LIGHT,
    alignItems: 'center',
  },
  actionsCancelText: {
    fontSize: 16,
    fontFamily: 'SourceSans3_600SemiBold',
    color: TEXT_SECONDARY,
  },
});
