/** Decorative stroke icons; the text beside them carries the meaning. */
import type { ReactNode } from "react";

function Icon({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const UploadIcon = ({ size }: { size?: number }) => (
  <Icon {...(size ? { size } : {})}>
    <path d="M12 15V4M7 9l5-5 5 5" />
    <path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
  </Icon>
);
export const CheckIcon = () => (
  <Icon size={13}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </Icon>
);
export const PauseIcon = () => (
  <Icon size={12}>
    <path d="M9 6v12M15 6v12" />
  </Icon>
);
