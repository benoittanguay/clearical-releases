import { useAnimation } from '../context/AnimationContext';

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function SplitAnimationOverlay() {
  const { flyingEntries, isAnimating } = useAnimation();

  if (!isAnimating || flyingEntries.length === 0) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 100 }}
    >
      {flyingEntries.map((entry, index) => {
        const { sourceRect, entry: entryData } = entry;
        const color = entryData.bucketColor || 'var(--bucket-blue)';

        return (
          <div
            key={entry.id}
            className="absolute animate-split-fly"
            style={{
              left: sourceRect.left,
              top: sourceRect.top,
              width: sourceRect.width,
              height: sourceRect.height,
              animationDelay: `${index * 50}ms`,
            }}
          >
            {/* Animated clone of the segment card */}
            <div
              className="w-full h-full rounded-xl p-4 shadow-lg"
              style={{
                backgroundColor: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border-primary)',
              }}
            >
              {/* Header with color indicator */}
              <div className="flex items-center gap-3 mb-2">
                <div
                  className="w-1 h-6 rounded flex-shrink-0"
                  style={{ background: color }}
                />
                <div className="flex flex-col">
                  <div className="text-xs text-[var(--color-text-secondary)]">
                    {formatDuration(entryData.duration)}
                  </div>
                </div>
              </div>

              {/* Description preview */}
              <div className="text-[12px] leading-relaxed text-[var(--color-text-primary)] line-clamp-2">
                {entryData.description || 'No description'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
