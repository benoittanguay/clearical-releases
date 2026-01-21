import React, { createContext, useContext, useState, useCallback } from 'react';

export interface FlyingEntry {
  id: string;
  sourceRect: DOMRect;
  entry: {
    description: string;
    duration: number;
    bucketColor?: string;
  };
}

interface AnimationContextType {
  flyingEntries: FlyingEntry[];
  isAnimating: boolean;
  startSplitAnimation: (entries: FlyingEntry[], onComplete: () => void) => void;
  clearAnimations: () => void;
}

const AnimationContext = createContext<AnimationContextType | undefined>(undefined);

export const AnimationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [flyingEntries, setFlyingEntries] = useState<FlyingEntry[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);
  const [completionCallback, setCompletionCallback] = useState<(() => void) | null>(null);

  const startSplitAnimation = useCallback((entries: FlyingEntry[], onComplete: () => void) => {
    setFlyingEntries(entries);
    setIsAnimating(true);
    // Store the callback - wrap in a function to avoid React state setter behavior
    setCompletionCallback(() => onComplete);

    // Animation duration is 600ms, but we call onComplete a bit earlier
    // to allow the view transition to start smoothly
    setTimeout(() => {
      setIsAnimating(false);
      setFlyingEntries([]);
      onComplete();
    }, 500);
  }, []);

  const clearAnimations = useCallback(() => {
    setFlyingEntries([]);
    setIsAnimating(false);
    if (completionCallback) {
      completionCallback();
      setCompletionCallback(null);
    }
  }, [completionCallback]);

  return (
    <AnimationContext.Provider
      value={{
        flyingEntries,
        isAnimating,
        startSplitAnimation,
        clearAnimations,
      }}
    >
      {children}
    </AnimationContext.Provider>
  );
};

export const useAnimation = () => {
  const context = useContext(AnimationContext);
  if (!context) {
    throw new Error('useAnimation must be used within an AnimationProvider');
  }
  return context;
};
