import React, { useEffect, useState, useRef } from 'react';
import './SplitFlapDisplay.css';

interface SplitFlapDigitProps {
  digit: string;
  prevDigit: string;
}

interface SplitFlapDisplayProps {
  value: string; // Format: "HH:MM:SS"
  size?: 'small' | 'medium' | 'large';
}

interface FlipClockContainerProps {
  children: React.ReactNode;
}

/**
 * Custom hook to track previous value
 * Returns the value from the previous render
 */
function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);

  useEffect(() => {
    ref.current = value;
  });

  return ref.current;
}

/**
 * Single split-flap digit with realistic mechanical flip animation
 *
 * Animation mechanics:
 * 1. Top flap (showing old digit top) flips DOWN from 0° to -90° (hinged at bottom)
 * 2. Bottom flap (showing new digit bottom) flips UP from 90° to 0° (hinged at top)
 * 3. Bottom flap starts after top flap passes ~45° for realism
 * 4. Both use gravity-style easing with subtle bounce on bottom flap
 */
export const SplitFlapDigit: React.FC<SplitFlapDigitProps> = ({ digit, prevDigit }) => {
  const [isFlipping, setIsFlipping] = useState(false);
  const [animationKey, setAnimationKey] = useState(0);

  useEffect(() => {
    // Only animate if the digit actually changed
    if (digit !== prevDigit) {
      console.log(`🔄 FLIP TRIGGERED: "${prevDigit}" → "${digit}"`);
      setIsFlipping(true);
      // Increment key to force new DOM elements and restart animation
      setAnimationKey(prev => prev + 1);

      // End animation after total duration (600ms top + 300ms delay + 500ms bottom = 1400ms max)
      const endTimer = setTimeout(() => {
        console.log(`✅ FLIP COMPLETE: "${digit}"`);
        setIsFlipping(false);
      }, 1400);

      return () => {
        clearTimeout(endTimer);
      };
    }
  }, [digit, prevDigit]);

  return (
    <div className="split-flap-digit">
      {/* Static top half - shows CURRENT digit top (always in sync with bottom) */}
      <div className="flap-half flap-top-static">
        <div className="flap-content flap-content-top">
          {digit}
        </div>
      </div>

      {/* Static bottom half - shows CURRENT digit bottom (always in sync with top) */}
      <div className="flap-half flap-bottom-static">
        <div className="flap-content flap-content-bottom">
          {digit}
        </div>
      </div>

      {/* Animated top flap - flips DOWN from 0° to -90° (hinged at bottom) */}
      {/* Shows the OLD digit flipping away */}
      {isFlipping && (
        <div key={`top-${animationKey}`} className="flap-half flap-top-animated">
          <div className="flap-content flap-content-top">
            {prevDigit}
          </div>
        </div>
      )}

      {/* Animated bottom flap - flips UP from 90° to 0° (hinged at top) */}
      {/* Shows the NEW digit flipping into place */}
      {isFlipping && (
        <div key={`bottom-${animationKey}`} className="flap-half flap-bottom-animated">
          <div className="flap-content flap-content-bottom">
            {digit}
          </div>
        </div>
      )}

      {/* Center split line for mechanical realism */}
      <div className="flap-split-line" />
    </div>
  );
};

/**
 * Full split-flap display for time values
 * Displays HH:MM:SS with mechanical flip animations
 */
export const SplitFlapDisplay: React.FC<SplitFlapDisplayProps> = ({
  value,
  size = 'medium'
}) => {
  // Track previous value to detect changes for animation
  const prevValue = usePrevious(value);

  // Parse time string into individual characters
  const parseTimeString = (timeStr: string): string[] => {
    // Remove colons and split into individual digits
    // Expected format: "HH:MM:SS"
    return timeStr.split('');
  };

  const currentDigits = parseTimeString(value);
  const previousDigits = prevValue ? parseTimeString(prevValue) : currentDigits;

  return (
    <div className={`split-flap-display split-flap-display--${size}`}>
      <div className="split-flap-container">
        {currentDigits.map((digit, index) => {
          const prevDigit = previousDigits[index] || digit;

          // Render colons as static separators
          if (digit === ':') {
            return (
              <div key={index} className="split-flap-separator">
                :
              </div>
            );
          }

          // Render digits as flap components
          return (
            <SplitFlapDigit
              key={index}
              digit={digit}
              prevDigit={prevDigit}
            />
          );
        })}
      </div>
    </div>
  );
};

/**
 * Container wrapper for the flip clock display
 * Provides dark background, orange accent border, and glass-like bezel effect
 * Similar to classic retro flip clocks with beveled housing
 */
export const FlipClockContainer: React.FC<FlipClockContainerProps> = ({ children }) => {
  return (
    <div className="flip-clock-container">
      <div className="flip-clock-bezel">
        <div className="flip-clock-inner">
          {children}
        </div>
      </div>
    </div>
  );
};

export default SplitFlapDisplay;
