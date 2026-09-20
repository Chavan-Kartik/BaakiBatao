import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BackButtonProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  label?: string;
  className?: string;
  onClick?: () => void;
}

export function BackButton({
  label = 'Back to cases',
  href = '#',
  className,
  onClick,
  ...props
}: BackButtonProps) {
  return (
    <a
      href={href}
      onClick={onClick}
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[12px] font-medium text-text-3 transition-colors hover:text-text hover:bg-hover',
        className,
      )}
      {...props}
    >
      <ArrowLeft
        className="size-3.5 transition-transform duration-200 group-hover:-translate-x-1"
        strokeWidth={2}
      />
      <span>{label}</span>
    </a>
  );
}
