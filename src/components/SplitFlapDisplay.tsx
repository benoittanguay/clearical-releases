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
 * Single split-flap digit with mechanical flip animation
 * Uses CSS 3D transforms to create the classic train station display effect
 */
export const SplitFlapDigit: React.FC<SplitFlapDigitProps> = ({ digit, prevDigit }) => {
  const [isFlipping, setIsFlipping] = useState(false);
  const [currentDigit, setCurrentDigit] = useState(digit);

  useEffect(() => {
    // Only animate if the digit actually changed and we have a previous digit
    if (digit !== prevDigit && digit !== currentDigit) {
      setIsFlipping(true);

      // End animation and update display
      const timer = setTimeout(() => {
        setCurrentDigit(digit);
        setIsFlipping(false);
      }, 400);

      return () => clearTimeout(timer);
    }
  }, [digit, prevDigit, currentDigit]);

  return (
    <div className="split-flap-digit">
      {/* Static top half - shows previous digit top */}
      <div className="flap-half flap-top">
        <div className="flap-content flap-content-top">
          {isFlipping ? prevDigit : currentDigit}
        </div>
      </div>

      {/* Static bottom half - shows current digit bottom */}
      <div className="flap-half flap-bottom">
        <div className="flap-content flap-content-bottom">
          {currentDigit}
        </div>
      </div>

      {/* Animated flipping top half (flips down to reveal new digit) */}
      {isFlipping && (
        <div className="flap-half flap-top flap-flip-top">
          <div className="flap-content flap-content-top">
            {prevDigit}
          </div>
        </div>
      )}

      {/* Center split line */}
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

export default SplitFlapDisplay;
