import { useState, useEffect, useRef, useCallback } from 'react';
import { ConfirmationModal } from './ConfirmationModal';

// Types
export interface SplitSuggestion {
  id: string;
  startTime: number;
  endTime: number;
  description: string;
  suggestedBucket?: { id: string; name: string; color: string };
  suggestedJiraKey?: string;
}

export interface SplittingAssistantProps {
  activity: {
    id: string;
    startTime: number;
    endTime: number;
    duration: number;
  };
  suggestions: SplitSuggestion[];
  isLoading?: boolean;
  onClose: () => void;
  onApply: (splits: SplitSuggestion[]) => void;
}

// Helper functions
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  return `${displayHour}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatTimeRange(startTime: number, endTime: number): string {
  return `${formatTime(startTime)} - ${formatTime(endTime)}`;
}

// Bucket colors available in CSS variables

export function SplittingAssistant({
  activity,
  suggestions: initialSuggestions,
  isLoading = false,
  onClose,
  onApply,
}: SplittingAssistantProps) {
  const [segments, setSegments] = useState<SplitSuggestion[]>(initialSuggestions);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    initialSuggestions[0]?.id || null
  );
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedCutIndex, setDraggedCutIndex] = useState<number | null>(null);
  const [addSplitPosition, setAddSplitPosition] = useState<number | null>(null);
  const [confirmationModal, setConfirmationModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const timelineRef = useRef<HTMLDivElement>(null);

  // Calculate cut points (boundaries between segments)
  const cutPoints = segments.slice(0, -1).map((seg) => seg.endTime);

  // Handle escape key to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        if (editingSegmentId) {
          setEditingSegmentId(null);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isLoading, editingSegmentId, onClose]);

  // Convert timestamp to percentage position on timeline
  const timeToPercent = (timestamp: number): number => {
    const { startTime, endTime } = activity;
    return ((timestamp - startTime) / (endTime - startTime)) * 100;
  };

  // Convert percentage position to timestamp
  const percentToTime = (percent: number): number => {
    const { startTime, endTime } = activity;
    return startTime + (percent / 100) * (endTime - startTime);
  };

  // Handle cut marker drag
  const handleCutDragStart = (cutIndex: number) => {
    setIsDragging(true);
    setDraggedCutIndex(cutIndex);
  };

  const handleCutDragMove = useCallback((e: MouseEvent) => {
    if (!isDragging || draggedCutIndex === null || !timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let percent = (x / rect.width) * 100;

    // Clamp between 5% and 95%
    percent = Math.max(5, Math.min(95, percent));

    const newTime = percentToTime(percent);

    // Update segments
    setSegments((prevSegments) => {
      const newSegments = [...prevSegments];

      // Update the end time of the segment before the cut
      newSegments[draggedCutIndex] = {
        ...newSegments[draggedCutIndex],
        endTime: newTime,
      };

      // Update the start time of the segment after the cut
      newSegments[draggedCutIndex + 1] = {
        ...newSegments[draggedCutIndex + 1],
        startTime: newTime,
      };

      return newSegments;
    });
  }, [isDragging, draggedCutIndex, activity.startTime, activity.endTime]);

  const handleCutDragEnd = useCallback(() => {
    setIsDragging(false);
    setDraggedCutIndex(null);
  }, []);

  // Attach mouse event listeners for dragging
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleCutDragMove);
      document.addEventListener('mouseup', handleCutDragEnd);
      return () => {
        document.removeEventListener('mousemove', handleCutDragMove);
        document.removeEventListener('mouseup', handleCutDragEnd);
      };
    }
  }, [isDragging, handleCutDragMove, handleCutDragEnd]);

  // Handle timeline hover for add split indicator
  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || isDragging) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = (x / rect.width) * 100;

    // Check if near existing cut markers
    const isNearMarker = cutPoints.some((cutTime) => {
      const cutPercent = timeToPercent(cutTime);
      return Math.abs(percent - cutPercent) < 5;
    });

    if (!isNearMarker && percent > 5 && percent < 95) {
      setAddSplitPosition(percent);
    } else {
      setAddSplitPosition(null);
    }
  };

  const handleTimelineMouseLeave = () => {
    setAddSplitPosition(null);
  };

  // Add a new split at the current position
  const handleAddSplit = () => {
    if (addSplitPosition === null) return;

    const newCutTime = percentToTime(addSplitPosition);

    // Find which segment to split
    const segmentIndex = segments.findIndex(
      (seg) => newCutTime >= seg.startTime && newCutTime < seg.endTime
    );

    if (segmentIndex === -1) return;

    const segmentToSplit = segments[segmentIndex];

    // Create two new segments
    const newSegments = [...segments];
    const firstHalf: SplitSuggestion = {
      ...segmentToSplit,
      id: `${segmentToSplit.id}-a`,
      endTime: newCutTime,
    };
    const secondHalf: SplitSuggestion = {
      ...segmentToSplit,
      id: `${segmentToSplit.id}-b`,
      startTime: newCutTime,
      description: '',
    };

    newSegments.splice(segmentIndex, 1, firstHalf, secondHalf);
    setSegments(newSegments);
    setAddSplitPosition(null);
  };

  // Remove a split (merge with next segment)
  const handleRemoveSplit = (segmentId: string) => {
    const segmentIndex = segments.findIndex((seg) => seg.id === segmentId);
    if (segmentIndex === -1 || segmentIndex === segments.length - 1) return;

    setConfirmationModal({
      isOpen: true,
      title: 'Remove Split',
      message: 'Remove this split? The segments will be merged.',
      onConfirm: () => {
        const newSegments = [...segments];
        const currentSegment = newSegments[segmentIndex];
        const nextSegment = newSegments[segmentIndex + 1];

        // Merge current with next
        const merged: SplitSuggestion = {
          ...currentSegment,
          endTime: nextSegment.endTime,
          description: currentSegment.description || nextSegment.description,
          suggestedBucket: currentSegment.suggestedBucket || nextSegment.suggestedBucket,
          suggestedJiraKey: currentSegment.suggestedJiraKey || nextSegment.suggestedJiraKey,
        };

        newSegments.splice(segmentIndex, 2, merged);
        setSegments(newSegments);

        // Clear selection if the removed segment was selected
        if (selectedSegmentId === segmentId) {
          setSelectedSegmentId(merged.id);
        }

        setConfirmationModal(null);
      },
    });
  };

  // Update segment description
  const handleUpdateDescription = (segmentId: string, newDescription: string) => {
    setSegments((prev) =>
      prev.map((seg) =>
        seg.id === segmentId ? { ...seg, description: newDescription } : seg
      )
    );
  };

  // Reset to initial suggestions
  const handleReset = () => {
    setConfirmationModal({
      isOpen: true,
      title: 'Reset Changes',
      message: 'Reset all changes to original AI suggestions?',
      onConfirm: () => {
        setSegments(initialSuggestions);
        setConfirmationModal(null);
      },
    });
  };

  // Apply splits
  const handleApply = () => {
    onApply(segments);
  };

  // Select segment
  const handleSelectSegment = (segmentId: string) => {
    setSelectedSegmentId(segmentId);
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-bg-primary)] rounded-[24px] w-full max-w-[900px] mx-4 shadow-2xl animate-scale-in max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 pb-4 border-b border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] flex-shrink-0">
          <h1
            className="text-2xl font-bold text-[var(--color-text-primary)] mb-2"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Splitting Assistant
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            AI has detected multiple projects in this recording. Review and adjust the suggested splits.
          </p>

          <div className="flex items-center gap-4 p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-primary)] rounded-xl">
            <div className="text-xl font-semibold text-[var(--color-text-primary)]">
              {formatDuration(activity.duration)}
            </div>
            <div className="text-sm text-[var(--color-text-secondary)]">
              {formatTimeRange(activity.startTime, activity.endTime)}
            </div>
            <div
              className="ml-auto px-3 py-1 rounded-full text-xs font-semibold"
              style={{
                background: 'var(--color-accent-muted)',
                color: 'var(--color-accent)',
              }}
            >
              {segments.length - 1} splits suggested
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Instructions */}
          <div
            className="p-4 rounded-xl mb-6 border"
            style={{
              background: 'var(--color-accent-muted)',
              borderColor: 'rgba(255, 72, 0, 0.15)',
            }}
          >
            <h3
              className="text-sm font-semibold mb-2"
              style={{
                fontFamily: 'var(--font-display)',
                color: 'var(--color-accent)',
              }}
            >
              How to use
            </h3>
            <ul className="text-xs text-[var(--color-text-secondary)] space-y-1">
              <li className="pl-4 relative before:content-['>'] before:absolute before:left-0 before:text-[var(--color-accent)] before:font-semibold">
                Drag cut markers to adjust split points
              </li>
              <li className="pl-4 relative before:content-['>'] before:absolute before:left-0 before:text-[var(--color-accent)] before:font-semibold">
                Hover over timeline to add new splits
              </li>
              <li className="pl-4 relative before:content-['>'] before:absolute before:left-0 before:text-[var(--color-accent)] before:font-semibold">
                Click segments to see details
              </li>
              <li className="pl-4 relative before:content-['>'] before:absolute before:left-0 before:text-[var(--color-accent)] before:font-semibold">
                Remove unwanted splits with the X button
              </li>
            </ul>
          </div>

          {/* Timeline Container */}
          <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-primary)] rounded-xl p-6 mb-6 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <h2
                className="text-base font-semibold text-[var(--color-text-primary)]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Timeline
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={handleReset}
                  className="px-4 py-2 text-xs font-medium rounded-full bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-quaternary)] transition-all flex items-center gap-2"
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                  Reset
                </button>
              </div>
            </div>

            {/* Timeline */}
            <div
              ref={timelineRef}
              className="relative h-20 mb-2"
              onMouseMove={handleTimelineMouseMove}
              onMouseLeave={handleTimelineMouseLeave}
            >
              {/* Timeline Track */}
              <div className="absolute top-1/2 left-0 right-0 h-12 -translate-y-1/2 bg-[var(--color-bg-tertiary)] rounded-lg overflow-hidden flex">
                {segments.map((segment, index) => {
                  const width = ((segment.endTime - segment.startTime) / activity.duration) * 100;
                  const isActive = segment.id === selectedSegmentId;
                  const color = segment.suggestedBucket?.color || 'var(--bucket-blue)';

                  return (
                    <div
                      key={segment.id}
                      className="relative h-full flex items-center justify-center cursor-pointer transition-all"
                      style={{
                        width: `${width}%`,
                        background: color,
                        filter: isActive ? 'brightness(1.1)' : undefined,
                        boxShadow: isActive ? 'inset 0 0 0 2px rgba(255, 255, 255, 0.3)' : undefined,
                      }}
                      onClick={() => handleSelectSegment(segment.id)}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.filter = 'brightness(1.05)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.filter = isActive ? 'brightness(1.1)' : '';
                      }}
                    >
                      <span className="text-[10px] font-semibold text-white px-2 truncate opacity-90 hover:opacity-100" style={{ textShadow: '0 1px 2px rgba(0, 0, 0, 0.3)' }}>
                        {segment.suggestedBucket?.name || `Segment ${index + 1}`}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Cut Markers */}
              {cutPoints.map((cutTime, index) => {
                const position = timeToPercent(cutTime);

                return (
                  <div
                    key={index}
                    className="absolute top-0 bottom-0 w-5 -translate-x-1/2 cursor-ew-resize z-10 flex items-center justify-center group"
                    style={{ left: `${position}%` }}
                    onMouseDown={() => handleCutDragStart(index)}
                  >
                    {/* Vertical line */}
                    <div className="absolute top-0 bottom-0 w-0.5 bg-[var(--color-text-primary)] rounded" />

                    {/* Draggable handle */}
                    <div className="w-4 h-6 bg-[var(--color-bg-secondary)] border-2 border-[var(--color-text-primary)] rounded flex items-center justify-center shadow-md transition-all group-hover:bg-[var(--color-accent)] group-hover:border-[var(--color-accent)] group-hover:scale-110">
                      <div className="w-1 h-2.5 bg-[repeating-linear-gradient(to_bottom,var(--color-text-secondary)_0px,var(--color-text-secondary)_2px,transparent_2px,transparent_4px)] group-hover:bg-[repeating-linear-gradient(to_bottom,white_0px,white_2px,transparent_2px,transparent_4px)]" />
                    </div>

                    {/* Tooltip */}
                    <div className="absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 px-3 py-2 bg-[var(--color-text-primary)] text-[var(--color-bg-primary)] text-[11px] rounded-lg whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-20 after:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-4 after:border-transparent after:border-t-[var(--color-text-primary)]">
                      {formatTime(cutTime)}
                    </div>
                  </div>
                );
              })}

              {/* Add Split Indicator */}
              {addSplitPosition !== null && (
                <div
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 bg-[var(--color-bg-secondary)] border-2 border-dashed border-[var(--color-text-tertiary)] rounded-full flex items-center justify-center text-sm text-[var(--color-text-tertiary)] cursor-pointer hover:bg-[var(--color-accent)] hover:border-[var(--color-accent)] hover:border-solid hover:text-white transition-all z-20"
                  style={{ left: `${addSplitPosition}%` }}
                  onClick={handleAddSplit}
                >
                  +
                </div>
              )}
            </div>

            {/* Time Labels */}
            <div className="flex justify-between text-[10px] text-[var(--color-text-tertiary)] pt-2">
              <span>{formatTime(activity.startTime)}</span>
              <span>{formatTime(activity.endTime)}</span>
            </div>
          </div>

          {/* Segment Cards */}
          <div className="space-y-3">
            {segments.map((segment) => {
              const isActive = segment.id === selectedSegmentId;
              const isEditing = segment.id === editingSegmentId;
              const duration = segment.endTime - segment.startTime;
              const color = segment.suggestedBucket?.color || 'var(--bucket-blue)';

              return (
                <div
                  key={segment.id}
                  className="bg-[var(--color-bg-secondary)] border rounded-xl p-4 cursor-pointer transition-all"
                  style={{
                    borderColor: isActive ? 'var(--color-accent)' : 'var(--color-border-primary)',
                    boxShadow: isActive ? '0 0 0 3px var(--color-accent-muted)' : undefined,
                  }}
                  onClick={() => handleSelectSegment(segment.id)}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.borderColor = 'var(--color-border-secondary)';
                      e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                      e.currentTarget.style.boxShadow = '';
                    }
                  }}
                >
                  {/* Header */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-1 h-8 rounded flex-shrink-0" style={{ background: color }} />

                    <div className="flex flex-col">
                      <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                        {formatTimeRange(segment.startTime, segment.endTime)}
                      </div>
                      <div className="text-xs text-[var(--color-text-secondary)]">
                        {formatDuration(duration)}
                      </div>
                    </div>

                    <div className="ml-auto flex gap-1">
                      <button
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] transition-all"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingSegmentId(isEditing ? null : segment.id);
                        }}
                        title="Edit"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-text-tertiary)] hover:bg-red-500/10 hover:text-red-500 transition-all"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveSplit(segment.id);
                        }}
                        title="Remove split"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Description */}
                  {isEditing ? (
                    <textarea
                      className="w-full p-3 text-[13px] leading-relaxed text-[var(--color-text-primary)] bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] rounded-lg mb-3 focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-muted)] transition-all"
                      style={{ fontFamily: 'var(--font-body)' }}
                      value={segment.description}
                      onChange={(e) => handleUpdateDescription(segment.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      rows={3}
                      placeholder="Add description..."
                    />
                  ) : (
                    <div className="text-[13px] leading-relaxed text-[var(--color-text-primary)] mb-3">
                      {segment.description || <span className="text-[var(--color-text-tertiary)] italic">No description</span>}
                    </div>
                  )}

                  {/* Suggestions */}
                  <div className="flex flex-wrap gap-2">
                    {segment.suggestedBucket && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[var(--color-bg-tertiary)] rounded-full text-[11px] font-medium text-[var(--color-text-secondary)]">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                        {segment.suggestedBucket.name}
                      </span>
                    )}
                    {segment.suggestedJiraKey && (
                      <span
                        className="px-2.5 py-1 rounded-full text-[11px] font-medium"
                        style={{
                          background: 'rgba(37, 99, 235, 0.1)',
                          color: 'var(--color-info)',
                        }}
                      >
                        {segment.suggestedJiraKey}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-6 pt-4 border-t border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] flex-shrink-0">
          <div className="flex justify-between items-center">
            <div className="text-xs text-[var(--color-text-secondary)]">
              {segments.length} segments will be created from this recording
            </div>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                disabled={isLoading}
                className="px-5 py-2.5 text-sm font-medium rounded-full bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-quaternary)] transition-all disabled:opacity-50"
                style={{ fontFamily: 'var(--font-body)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleApply}
                disabled={isLoading}
                className="px-6 py-2.5 text-sm font-semibold rounded-full bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-all shadow-lg flex items-center gap-2 disabled:opacity-50"
                style={{ fontFamily: 'var(--font-body)' }}
              >
                {isLoading ? (
                  <>
                    <svg
                      className="w-4 h-4 animate-spin"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Processing...
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Apply Splits
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmationModal && (
        <ConfirmationModal
          isOpen={confirmationModal.isOpen}
          onClose={() => setConfirmationModal(null)}
          onConfirm={confirmationModal.onConfirm}
          title={confirmationModal.title}
          message={confirmationModal.message}
          confirmText="Confirm"
          confirmVariant="primary"
        />
      )}
    </div>
  );
}
