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
  // Ref to store the "from" digit - captured at transition start, stable throughout animation
  // Initialize with prevDigit to handle mount during a transition
  const fromDigitRef = useRef(prevDigit);

  // Detect a new transition starting: digit changed AND we're not already animating
  // This is true on the FIRST render after props change, before useEffect runs
  const isNewTransition = digit !== prevDigit && !isFlipping;

  // Capture the "from" digit whenever props indicate a transition
  // This handles both initial transitions and rapid transitions while already flipping
  if (digit !== prevDigit) {
    fromDigitRef.current = prevDigit;
  }

  // Show animation elements when either actively flipping OR on first render of new transition
  const showAnimation = isFlipping || isNewTransition;

  useEffect(() => {
    // Only animate if the digit actually changed
    if (digit !== prevDigit) {
      console.log(`🔄 FLIP TRIGGERED: "${prevDigit}" → "${digit}"`);
      setIsFlipping(true);
      // Increment key to force new DOM elements and restart animation
      setAnimationKey(prev => prev + 1);

      // End animation after animations complete (300ms delay + 500ms bottom = 800ms)
      // Add small buffer for animation-fill-mode: forwards to settle
      const endTimer = setTimeout(() => {
        console.log(`✅ FLIP COMPLETE: "${digit}"`);
        setIsFlipping(false);
      }, 850);

      return () => {
        clearTimeout(endTimer);
      };
    }
  }, [digit, prevDigit]);

  return (
    <div className="split-flap-digit">
      {/* Static top half - shows CURRENT digit top (revealed as animated top flap flips away) */}
      <div className="flap-half flap-top-static">
        <div className="flap-content flap-content-top">
          {digit}
        </div>
      </div>

      {/* Static bottom half - ALWAYS shows current digit (no content switch = no flicker) */}
      <div className="flap-half flap-bottom-static">
        <div className="flap-content flap-content-bottom">
          {digit}
        </div>
      </div>

      {/* Old digit overlay - shows OLD digit during flip, covered by animated bottom flap */}
      {/* Hidden when not animating */}
      <div
        key={`old-overlay-${animationKey}`}
        className={`flap-half flap-bottom-static flap-old-overlay ${showAnimation ? 'flap-active' : 'flap-hidden'}`}
      >
        <div className="flap-content flap-content-bottom">
          {fromDigitRef.current}
        </div>
      </div>

      {/* Animated top flap - flips DOWN from 0° to -90° (hinged at bottom) */}
      {/* Shows the OLD digit flipping away. Hidden when not animating. */}
      <div
        key={`top-${animationKey}`}
        className={`flap-half flap-top-animated ${showAnimation ? 'flap-active' : 'flap-hidden'}`}
      >
        <div className="flap-content flap-content-top">
          {fromDigitRef.current}
        </div>
      </div>

      {/* Animated bottom flap - flips UP from 90° to 0° (hinged at top) */}
      {/* Shows the NEW digit. STAYS VISIBLE after animation to prevent flicker. */}
      {/* Only resets when key changes (next animation starts) */}
      <div
        key={`bottom-${animationKey}`}
        className={`flap-half flap-bottom-animated flap-bottom-persistent ${showAnimation ? 'flap-animating' : ''}`}
      >
        <div className="flap-content flap-content-bottom">
          {digit}
        </div>
      </div>

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
