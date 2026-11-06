"use client";

import * as Dd from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
}

export function Menu({ trigger, items, align = "end" }: { trigger: ReactNode; items: MenuItem[]; align?: "start" | "center" | "end" }) {
  return (
    <Dd.Root>
      <Dd.Trigger asChild>{trigger}</Dd.Trigger>
      <Dd.Portal>
        <Dd.Content
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className="anim-pop z-50 min-w-48 rounded-card border border-line bg-surface p-1 text-[13px] text-fg shadow-pop"
        >
          {items.map((it, i) => (
            <div key={i}>
              {it.separatorBefore && <Dd.Separator className="my-1 h-px bg-line" />}
              <Dd.Item
                disabled={it.disabled}
                onSelect={it.onSelect}
                className={`flex cursor-pointer select-none items-center gap-2 rounded-[6px] px-2.5 py-1.5 outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-surface-2 max-md:min-h-11 ${
                  it.danger ? "text-danger" : ""
                }`}
              >
                {it.icon && <span className="text-fg-2">{it.icon}</span>}
                {it.label}
              </Dd.Item>
            </div>
          ))}
        </Dd.Content>
      </Dd.Portal>
    </Dd.Root>
  );
}
