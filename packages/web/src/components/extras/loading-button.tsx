import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LoadingButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  loadingText?: string;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

export const LoadingButton = React.forwardRef<HTMLButtonElement, LoadingButtonProps>(
  (
    {
      children,
      loading = false,
      loadingText,
      disabled,
      variant = 'primary',
      size = 'md',
      className,
      ...props
    },
    ref,
  ) => {
    const variants = {
      primary: 'bg-brand text-white hover:bg-brand/90 focus-visible:ring-brand shadow-xs',
      secondary: 'bg-surface text-text hover:bg-hover border border-border',
      outline: 'border border-border text-text-2 hover:bg-hover hover:text-text',
      ghost: 'text-text-2 hover:bg-hover hover:text-text',
      danger: 'bg-disputed text-white hover:bg-disputed/90 focus-visible:ring-disputed',
    };

    const sizes = {
      sm: 'h-8 px-2.5 text-[12px] gap-1.5 rounded-sm',
      md: 'h-9 px-3.5 text-[13px] gap-2 rounded-sm',
      lg: 'h-10 px-4 text-[14px] gap-2.5 rounded-md',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center font-medium transition-all duration-150 select-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.99]',
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      >
        {loading && (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-current" strokeWidth={2.25} />
        )}
        <span className={cn('truncate', loading && !loadingText && 'opacity-0')}>{loading && loadingText ? loadingText : children}</span>
      </button>
    );
  },
);

LoadingButton.displayName = 'LoadingButton';
