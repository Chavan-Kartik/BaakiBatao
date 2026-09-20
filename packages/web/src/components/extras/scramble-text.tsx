import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface ScrambleTextProps {
  text: string;
  className?: string;
  characters?: string;
  speed?: number;
  revealDuration?: number;
  trigger?: unknown;
  as?: keyof React.JSX.IntrinsicElements;
}

const HEX_CHARS = '0123456789abcdefABCDEF';
const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';

export function ScrambleText({
  text,
  className,
  characters = ALPHANUMERIC,
  speed = 30,
  revealDuration = 600,
  trigger,
  as: Component = 'span',
}: ScrambleTextProps) {
  const [displayText, setDisplayText] = useState(text);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    let startTime = performance.now();
    const length = text.length;

    const update = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / revealDuration);
      const revealedCount = Math.floor(progress * length);

      let result = '';
      for (let i = 0; i < length; i++) {
        if (i < revealedCount || text[i] === ' ' || text[i] === '·' || text[i] === '₹') {
          result += text[i];
        } else {
          result += characters[Math.floor(Math.random() * characters.length)];
        }
      }

      setDisplayText(result);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(update);
      } else {
        setDisplayText(text);
      }
    };

    frameRef.current = requestAnimationFrame(update);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [text, characters, revealDuration, speed, trigger]);

  return <Component className={cn('font-mono transition-colors', className)}>{displayText}</Component>;
}

export function HashScramble({
  hash,
  className,
  sliceLength = 32,
}: {
  hash: string;
  className?: string;
  sliceLength?: number;
}) {
  const display = hash.length > sliceLength ? `${hash.slice(0, sliceLength)}…` : hash;
  return (
    <ScrambleText
      text={display}
      characters={HEX_CHARS}
      revealDuration={750}
      className={cn('text-text-2 select-all', className)}
    />
  );
}
