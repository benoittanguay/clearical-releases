import React, { useEffect, useState } from 'react';
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
 * Single split-flap digit with mechanical flip animation
 * Uses CSS 3D transforms to create the classic train station display effect
 */
export const SplitFlapDigit: React.FC<SplitFlapDigitProps> = ({ digit, prevDigit }) => {
  const [isFlipping, setIsFlipping] = useState(false);
  const [displayDigit, setDisplayDigit] = useState(digit);
  const [animatingDigit, setAnimatingDigit] = useState(prevDigit);

  useEffect(() => {
    if (digit !== prevDigit) {
      // Start the flip animation
      setIsFlipping(true);
      setAnimatingDigit(prevDigit);

      // Halfway through animation, update the back digit
      const halfwayTimer = setTimeout(() => {
        setDisplayDigit(digit);
      }, 200);

      // End animation
      const endTimer = setTimeout(() => {
        setIsFlipping(false);
      }, 400);

      return () => {
        clearTimeout(halfwayTimer);
        clearTimeout(endTimer);
      };
    }
  }, [digit, prevDigit]);

  return (
    <div className="split-flap-digit">
      {/* Static bottom half */}
      <div className="flap-half flap-bottom">
        <div className="flap-content flap-content-bottom">
          {displayDigit}
        </div>
      </div>

      {/* Static top half (shows current digit when not animating) */}
      <div className="flap-half flap-top">
        <div className="flap-content flap-content-top">
          {displayDigit}
        </div>
      </div>

      {/* Animated flipping top half (shows when transitioning) */}
      {isFlipping && (
        <div className="flap-half flap-top flap-flip-top">
          <div className="flap-content flap-content-top">
            {animatingDigit}
          </div>
        </div>
      )}

      {/* Animated flipping bottom half (reveals new digit) */}
      {isFlipping && (
        <div className="flap-half flap-bottom flap-flip-bottom">
          <div className="flap-content flap-content-bottom">
            {displayDigit}
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
  const [prevValue, setPrevValue] = useState(value);

  useEffect(() => {
    if (value !== prevValue) {
      setPrevValue(value);
    }
  }, [value, prevValue]);

  // Parse time string into individual characters
  const parseTimeString = (timeStr: string): string[] => {
    // Remove colons and split into individual digits
    // Expected format: "HH:MM:SS"
    return timeStr.split('');
  };

  const currentDigits = parseTimeString(value);
  const previousDigits = parseTimeString(prevValue);

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
