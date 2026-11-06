"use client";

import * as RxTooltip from "@radix-ui/react-tooltip";
import * as RxPopover from "@radix-ui/react-popover";
import * as RxSwitch from "@radix-ui/react-switch";
import * as RxDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-control font-medium select-none whitespace-nowrap transition-colors duration-150 ease-out disabled:opacity-45 disabled:pointer-events-none";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover active:brightness-95",
  secondary: "border border-line-strong bg-surface text-fg hover:bg-surface-2 active:bg-surface-3",
  ghost: "text-fg-2 hover:bg-surface-2 hover:text-fg active:bg-surface-3",
  danger: "border border-line-strong bg-surface text-danger hover:bg-danger-soft",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] max-md:min-h-11",
  md: "h-9 px-4 text-[14px] max-md:min-h-11",
};

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...p },
  ref,
) {
  return <button ref={ref} type={type} className={cn(base, variants[variant], sizes[size], className)} {...p} />;
});

interface IconBtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  tip?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconBtnProps>(function IconButton(
  { label, active, className, type = "button", tip = true, children, ...p },
  ref,
) {
  const btn = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-control text-fg-2 transition-colors duration-150 hover:bg-surface-2 hover:text-fg active:bg-surface-3 disabled:opacity-45 disabled:pointer-events-none max-md:size-11",
        active && "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent",
        className,
      )}
      {...p}
    >
      {children}
    </button>
  );
  return tip ? <Tip label={label}>{btn}</Tip> : btn;
});

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RxTooltip.Provider delayDuration={350}>{children}</RxTooltip.Provider>;
}

export function Tip({ label, children, side = "bottom" }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <RxTooltip.Root>
      <RxTooltip.Trigger asChild>{children}</RxTooltip.Trigger>
      <RxTooltip.Portal>
        <RxTooltip.Content
          side={side}
          sideOffset={6}
          className="anim-fade z-[60] max-w-64 rounded-md bg-fg px-2 py-1 text-xs text-bg shadow-pop"
        >
          {label}
        </RxTooltip.Content>
      </RxTooltip.Portal>
    </RxTooltip.Root>
  );
}

export function Popover({
  trigger,
  children,
  align = "end",
  className,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <RxPopover.Root>
      <RxPopover.Trigger asChild>{trigger}</RxPopover.Trigger>
      <RxPopover.Portal>
        <RxPopover.Content
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            "anim-pop z-50 w-72 rounded-card border border-line bg-surface p-3 text-sm text-fg shadow-pop outline-none",
            className,
          )}
        >
          {children}
        </RxPopover.Content>
      </RxPopover.Portal>
    </RxPopover.Root>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <RxSwitch.Root
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      disabled={disabled}
      className="relative h-[22px] w-[38px] shrink-0 rounded-full bg-surface-3 transition-colors duration-150 data-[state=checked]:bg-accent disabled:opacity-45 max-md:my-2.5"
    >
      <RxSwitch.Thumb className="block size-[18px] translate-x-[2px] rounded-full bg-white shadow-sm transition-transform duration-150 data-[state=checked]:translate-x-[18px]" />
    </RxSwitch.Root>
  );
}

export function SwitchRow({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1 text-[13px] text-fg">
      <span>{label}</span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </label>
  );
}

export interface SegOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  tip?: ReactNode;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  full,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegOption<T>[];
  label: string;
  className?: string;
  full?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex rounded-control bg-surface-3/70 p-0.5", full && "flex w-full", className)}
    >
      {options.map((o) => {
        const sel = o.value === value;
        const btn = (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={sel}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] px-3 text-[13px] font-medium transition-all duration-150 max-md:min-h-10",
              full && "flex-1",
              sel ? "bg-surface text-fg shadow-[0_0_0_1px_var(--line),0_1px_2px_rgba(0,0,0,0.06)]" : "text-fg-2 hover:text-fg",
              o.disabled && "cursor-not-allowed opacity-50 hover:text-fg-2",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
        // desabilitado não dispara hover no <button>; o span garante o tooltip
        return o.tip ? (
          <Tip key={o.value} label={o.tip}>
            <span className={cn("inline-flex", full && "flex-1")}>{btn}</span>
          </Tip>
        ) : (
          btn
        );
      })}
    </div>
  );
}

export function ProgressBar({ percent, className }: { percent: number | null; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent == null ? undefined : Math.round(percent)}
      className={cn("relative h-1 w-full overflow-hidden rounded-full bg-surface-3", className)}
    >
      {percent == null ? (
        <div className="absolute inset-y-0 w-1/3 animate-[indet_1.4s_ease-in-out_infinite] rounded-full bg-accent" />
      ) : (
        <div className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out" style={{ width: `${Math.max(2, Math.min(100, percent))}%` }} />
      )}
    </div>
  );
}

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { label: string }>(function Select(
  { label, className, children, ...p },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-label={label}
      className={cn(
        "h-9 rounded-control border border-line-strong bg-surface px-2.5 text-[13px] text-fg hover:bg-surface-2 disabled:opacity-45 max-md:min-h-11",
        className,
      )}
      {...p}
    >
      {children}
    </select>
  );
});

export function Banner({ tone = "info", children, className }: { tone?: "info" | "warning" | "danger" | "success"; children: ReactNode; className?: string }) {
  const tones = {
    info: "bg-surface-2 text-fg-2",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
    success: "bg-success-soft text-success",
  };
  return <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-control px-3 py-2 text-[13px] leading-5", tones[tone], className)}>{children}</div>;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <RxDialog.Root open={open} onOpenChange={onOpenChange}>
      <RxDialog.Portal>
        <RxDialog.Overlay className="anim-fade fixed inset-0 z-50 bg-[var(--overlay)]" />
        <RxDialog.Content className="anim-pop fixed left-1/2 top-1/2 z-50 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-surface p-5 shadow-dialog outline-none">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <RxDialog.Title className="text-[16px] font-semibold">{title}</RxDialog.Title>
              {description && <RxDialog.Description className="mt-1 text-[13px] text-fg-2">{description}</RxDialog.Description>}
            </div>
            <RxDialog.Close asChild>
              <IconButton label="Fechar" tip={false}>
                <X size={16} strokeWidth={1.75} />
              </IconButton>
            </RxDialog.Close>
          </div>
          {children}
        </RxDialog.Content>
      </RxDialog.Portal>
    </RxDialog.Root>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[5px] border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-2">{children}</kbd>
  );
}
